// The plumbing behind both Open Graph cards: scripts/build-og-card.mjs draws
// the single site-wide one, scripts/build-session-cards.mjs one per session,
// and neither of the two hard parts is worth solving twice.
//
// The first is the font. Montserrat is vendored only as subsetted woff2 for
// the browser (src/css/fonts), and nothing installs it on the machines that
// build this site, so librsvg on its own would fall back to whatever
// sans-serif fontconfig happens to offer and say nothing about it. The same
// subset-font that lib/fonts.mjs uses converts the weights a card needs to
// TrueType, writes them to a throwaway directory, and points fontconfig at
// that directory *alone* - the generated fonts.conf includes none of the
// system configuration, so a host that has some other Montserrat installed, or
// no fonts at all, still produces the same image. The directory is removed
// when the run ends, whether or not it succeeded.
//
// The second is measurement, which the site-wide card could do without and a
// card per session cannot. librsvg sets whatever it is given: a line wider
// than the card is drawn straight off the edge and the PNG comes back with the
// end of the title missing, silently. So the advance widths are read out of
// the very TrueType files fontconfig is about to be pointed at - the font that
// will actually render, not an approximation of it - and the wrapper in
// build-session-cards.mjs measures every candidate line before drawing it.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import subsetFont from "subset-font";

const FONT_SRC = path.join(import.meta.dirname, "../src/css/fonts");

// The 1.91:1 every unfurler asks for, at the resolution they all accept, so
// nothing is scaled up on a retina screen and nothing is cropped away.
export const WIDTH = 1200;
export const HEIGHT = 630;

// Weight 800 is the wordmark weight the design uses for headings, 600 its
// small labels. Nothing on either card is set in anything else.
const WEIGHTS = [800, 600];

// Google's two Latin subsets, tried in this order. Everything the cards set
// today - Norwegian vowels, an en dash, a curly apostrophe - lives in the
// first, so the second is normally never opened. It is here because the
// programme is refetched hourly and a talk title is free text: the day a
// session is named after Gödel or Przybył, the glyph has to come from
// somewhere rather than being dropped on the floor.
const RANGES = ["latin", "latin-ext"];

// What a character with no glyph anywhere is assumed to cost when measuring.
// Deliberately generous: over-estimating a line's width breaks it early, which
// is merely ugly, while under-estimating runs it off the edge of the card.
const UNKNOWN_ADVANCE = 0.7;

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Advance widths, in ems, for every character a TrueType file can set.
 *
 * Only what answering "how wide is this string?" needs: the character-to-glyph
 * map, and the horizontal metric each glyph carries. Kerning is not read, and
 * that is a deliberate simplification - it lives in GPOS, it is almost always
 * negative, and a measurement that ignores it is a little wide rather than a
 * little narrow, which is the safe direction to be wrong in when the answer
 * decides whether a line fits.
 */
function advances(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o) => dv.getUint16(o);
  const u32 = (o) => dv.getUint32(o);

  const tables = new Map();
  for (let i = 0, n = u16(4); i < n; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(...[0, 1, 2, 3].map((k) => dv.getUint8(rec + k)));
    tables.set(tag, u32(rec + 8));
  }

  const unitsPerEm = u16(tables.get("head") + 18);
  // The last entry in hmtx's metric array covers every glyph after it, which is
  // how a font stores a run of equally wide glyphs without repeating itself.
  const numHMetrics = u16(tables.get("hhea") + 34);
  const hmtx = tables.get("hmtx");
  const em = (gid) => u16(hmtx + Math.min(gid, numHMetrics - 1) * 4) / unitsPerEm;

  // Prefer the subtable that can express the most: full Unicode, then the BMP,
  // then whatever the Unicode platform offers.
  const cmap = tables.get("cmap");
  let table = 0;
  let best = -1;
  for (let i = 0, n = u16(cmap + 2); i < n; i++) {
    const rec = cmap + 4 + i * 8;
    const [platform, encoding] = [u16(rec), u16(rec + 2)];
    const score =
      platform === 3 && encoding === 10 ? 3
      : platform === 3 && encoding === 1 ? 2
      : platform === 0 ? 1 : 0;
    if (score > best) [best, table] = [score, cmap + u32(rec + 4)];
  }

  const widths = new Map();
  const format = u16(table);
  if (format === 4) {
    const segments = u16(table + 6) / 2;
    const ends = table + 14;
    const starts = ends + segments * 2 + 2; // the pair is separated by a reserved u16
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    for (let s = 0; s < segments; s++) {
      const [start, end] = [u16(starts + s * 2), u16(ends + s * 2)];
      if (start === 0xffff) continue; // the mandatory terminating segment
      const delta = u16(deltas + s * 2);
      const rangeOffset = u16(ranges + s * 2);
      for (let c = start; c <= end; c++) {
        let gid;
        if (rangeOffset === 0) gid = (c + delta) & 0xffff;
        else {
          gid = u16(ranges + s * 2 + rangeOffset + (c - start) * 2);
          if (gid) gid = (gid + delta) & 0xffff;
        }
        if (gid) widths.set(c, em(gid));
      }
    }
  } else if (format === 12) {
    for (let g = 0, n = u32(table + 12); g < n; g++) {
      const rec = table + 16 + g * 12;
      const [start, end, gid] = [u32(rec), u32(rec + 4), u32(rec + 8)];
      for (let c = start; c <= end; c++) widths.set(c, em(gid + (c - start)));
    }
  }
  return widths;
}

/**
 * Fill `dir` with the faces the cards need, as TrueType, and a fonts.conf that
 * makes it the only place fontconfig will look. Answers with the advance
 * widths of everything that ended up installed, per weight.
 *
 * The characters come from the text about to be drawn rather than from a fixed
 * list, so a longer date or a title in a language nobody anticipated cannot
 * quietly lose a glyph and leave a hole in the image.
 */
async function installFonts(dir, chars) {
  const metrics = {};

  for (const weight of WEIGHTS) {
    const widths = new Map();
    for (const range of RANGES) {
      // Only what no face has covered yet, so the second subset comes out
      // empty - and is therefore never written - whenever the first sufficed.
      const wanted = [...chars].filter((c) => !widths.has(c.codePointAt(0)));
      if (!wanted.length) break;

      const source = readFileSync(path.join(FONT_SRC, `montserrat-${weight}-${range}.woff2`));
      const text = wanted.join("");
      let found;
      try {
        const face = await subsetFont(source, text, { targetFormat: "sfnt" });
        // The metrics come from a second subset with the weight axis pinned,
        // and only the unpinned face above is written out. Google now serves
        // Montserrat as a single variable font - all five "latin" files under
        // src/css/fonts are byte-identical - so the hmtx of the file handed to
        // fontconfig describes weight 400 no matter which name it arrived
        // under, and measuring it would under-read every heading by a tenth.
        // Pinning the axis produces a static instance whose advances match
        // what pango draws to the pixel. It is not what gets installed because
        // instancing also nudges the outlines: the rendered card is a shade
        // different, and src/icons/og.png is committed art that must not move
        // for a change that is invisible.
        const pinned = await subsetFont(source, text, {
          targetFormat: "sfnt",
          variationAxes: { wght: weight },
        });
        found = advances(pinned);
        if (found.size) writeFileSync(path.join(dir, `Montserrat-${weight}-${range}.ttf`), face);
      } catch (err) {
        // A face that carries none of what was asked for is not a reason to
        // fail an hourly deploy: every other character still draws, and the
        // warning says which run to go and look at.
        console.warn(`  ! montserrat-${weight}-${range}: ${err.message}`);
        continue;
      }
      for (const [code, width] of found) widths.set(code, width);
    }
    metrics[weight] = widths;
  }

  // fontconfig wants somewhere to write its cache; giving it one inside the
  // throwaway directory keeps it out of the user's home as well as the repo.
  mkdirSync(path.join(dir, "cache"), { recursive: true });
  writeFileSync(
    path.join(dir, "fonts.conf"),
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n` +
      `<fontconfig>\n  <dir>${dir}</dir>\n  <cachedir>${dir}/cache</cachedir>\n</fontconfig>\n`,
  );

  return metrics;
}

/**
 * Install the fonts, hand `body` what it takes to draw cards with them, and
 * take the fonts down again on the way out.
 *
 * `chars` must cover every character any card in this run may set. Passing the
 * whole programme's worth rather than only the cards being redrawn is what
 * keeps the output stable: the installed font is then the same on a run that
 * redraws one card and a run that redraws all of them, so a card's pixels
 * depend on its own text and on nothing else.
 */
export async function withCardRenderer(chars, body) {
  // Created before the try so that a failure while subsetting still takes the
  // directory with it on the way out.
  const fontDir = mkdtempSync(path.join(os.tmpdir(), "javazone-og-"));
  try {
    const metrics = await installFonts(fontDir, chars);

    // fontconfig reads its configuration once, when librsvg first asks it a
    // question, so the environment has to be set before sharp is loaded at all
    // - hence the dynamic import rather than one at the top of the file.
    process.env.FONTCONFIG_FILE = path.join(fontDir, "fonts.conf");
    const { default: sharp } = await import("sharp");

    /** How wide `text` is, in pixels, set in `weight` at `size` pixels. */
    const measure = (text, size, weight) => {
      const widths = metrics[weight];
      let em = 0;
      for (const c of text) em += widths.get(c.codePointAt(0)) ?? UNKNOWN_ADVANCE;
      return em * size;
    };

    // No withMetadata(): these files are committed, and a date or a machine
    // name in a PNG chunk would make every regeneration a diff even when the
    // pixels are identical.
    //
    // palette: false is spelled out rather than left to libvips, and the
    // saving it turns down is a large one: measured over 25 session cards,
    // quantising takes 1481 kB to 787 kB - 53%, about 28 kB a card, and the
    // whole set from 8.84 MiB to 4.70 MiB - for a maximum channel delta of 26
    // and a mean of 0.045, which is to say nothing anyone can see.
    //
    // It stays off anyway, because the size of the committed set has been
    // ruled not to be a concern, and full colour is what keeps the pixels the
    // hex values in the source asked for rather than a quantiser's reading of
    // them. If that ruling ever changes, this line is where to change it.
    //
    // removeAlpha because the ground covers the whole frame: librsvg hands
    // back RGBA regardless, and carrying a channel that is 255 everywhere
    // costs a third of the file for nothing.
    const render = (svg) =>
      sharp(Buffer.from(svg))
        .removeAlpha()
        .png({ palette: false, compressionLevel: 9 })
        .toBuffer();

    // sharp goes out with it because nothing outside here may import it: the
    // ordering above is only safe as long as this module is the first and
    // only place the module is loaded. Anything else a card needs sharp for -
    // scaling the vendored wordmark, say - has to be done from in here.
    return await body({ render, measure, sharp });
  } finally {
    rmSync(fontDir, { recursive: true, force: true });
  }
}
