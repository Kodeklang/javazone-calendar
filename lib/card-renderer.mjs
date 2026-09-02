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
//
// What the two scripts share beyond those is the card itself: the palette, the
// margins, the wordmark and where it sits, and the settings the finished SVG is
// rasterised and encoded with. Those live here rather than in either script
// because the two cards are meant to be recognisably the same object - the
// front page's unfurl and a talk's unfurl land in the same channel minutes
// apart - and a constant duplicated across two files is a constant that drifts.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import subsetFont from "subset-font";

const FONT_SRC = path.join(import.meta.dirname, "../src/css/fonts");

// JavaZone's own 2026 wordmark, vendored from
// https://2026.javazone.no/assets/JZ26-Logo-OnlyText-transp-BDAN5ewJ.png on
// 2026-09-02. Theirs, not ours: it is on the cards because the cards are about
// their conference. Vendored rather than fetched at generation time because
// that filename is content-hashed and will change under us on their next
// deploy, and a build that quietly stopped finding it would draw 155 cards
// with a hole in the corner before anybody noticed.
const WORDMARK_FILE = path.join(import.meta.dirname, "../src/icons/javazone-wordmark.png");

// The 1.91:1 every unfurler asks for, at the resolution they all accept, so
// nothing is scaled up on a retina screen and nothing is cropped away.
export const WIDTH = 1200;
export const HEIGHT = 630;

// Margins wide enough that a platform trimming a few pixels off the edge of a
// card takes nothing with it.
export const LEFT = 88;
export const RIGHT = WIDTH - 88;

// Where the wordmark sits, on every card there is. Both the site-wide card and
// the 155 session cards place it here and at this size, which is the whole
// reason it is decided in this file rather than in either script: an unfurled
// session and the front page are meant to read as two of a kind, and the mark
// landing on the same pixels in both is most of what does that. It is
// upstream's asset and the widest thing on a session card, so it is
// deliberately held down to a size the title can dominate - at Slack's
// rendered width the card is 360px across and this is 108px of it.
//
// Only the vertical is exported: `wordmark()` below places the mark itself, and
// a session card needs the same y for the format label it sets opposite it.
const MARK_W = 360;
export const MARK_Y = 62;

// The site's own colours, shared by both cards for the same reason the
// wordmark's placement is: the dark blues are manifest.njk's theme-color and
// background_color, and the muted blue is site.js's FALLBACK_COLOUR.
export const INK = "#ffffff";
export const MUTED = "#aecfff";
export const GROUND_TOP = "#153862";
export const GROUND_BOTTOM = "#0a2747";

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
    // removeAlpha because the ground covers the whole frame: librsvg hands
    // back RGBA regardless, and carrying a channel that is 255 everywhere
    // costs a third of the file for nothing.
    //
    // `palette` halves a card, and the reason it can be turned on without
    // costing anything is particular to this design rather than general. The
    // ground is a large, smooth gradient, which is exactly what a quantiser
    // damages - but it only steps through 54 values from top to bottom, and
    // being by far the biggest area on the card it is what libimagequant
    // spends its palette on first. Measured on three session cards, a sparse
    // one, a busy one and one in between: every pixel of open ground comes
    // back bit-identical, max delta 0 over 151527 sampled pixels, and the 1-2%
    // of pixels that do move are the antialiasing along type and wordmark
    // edges, at most 29 of 255 and invisible at 3x magnification. The
    // site-wide card measures the same way now that it is the same design on
    // the same ground - 54 levels kept, open ground bit-identical, 1.83% of
    // subpixels moving by at most 26 - so it is quantised too.
    //
    // dither: 0 deliberately. Dithering exists to hide banding, there is no
    // banding to hide, and the noise it adds would only make the ground
    // compress worse. `quality` is deliberately left at its default, which
    // keeps all 256 entries: lowering it is the setting that does damage -
    // at 95 the ground drops to 22 levels and steps by 2, at 80 to 7 levels
    // and steps of 4 across 105-row bands, which is visible banding on a card
    // this open. `colours` is not passed because this version of sharp
    // ignores it; `quality` is the knob that actually moves the palette.
    //
    // Opt-in rather than on by default, because it is one of the settings
    // scripts/build-session-cards.mjs hashes into a card's manifest entry and
    // that is the only place the set of them is written down.
    const render = (svg, { palette = false } = {}) =>
      sharp(Buffer.from(svg))
        .removeAlpha()
        .png({ palette, dither: 0, compressionLevel: 9 })
        .toBuffer();

    /**
     * The wordmark, as the `<image>` element every card places it with, and a
     * short key standing in for that element when a card is hashed.
     *
     * Scaled through libvips rather than in the SVG: librsvg would resample it
     * with a box filter on every one of the 155 cards, where doing it once
     * here is both sharper and, at this reduction, a great deal faster. It is
     * quantised on the way in as well - worth only about 0.4 kB of a finished
     * card now that the card is quantised too, but it takes the base64 in the
     * SVG source from 32.5 kB to 9.2 kB, and that source is parsed and decoded
     * once per session.
     *
     * The scaled bytes must not reach a hash, which is what `key` is for: a
     * card is hashed from its SVG with `key` substituted for `href`. libvips'
     * quantiser is deterministic for a given version, but not necessarily
     * identical between a laptop and the runner, and a hash that disagreed
     * across the two would have each of them redrawing all 155 cards over the
     * other's. The vendored file and the width it is drawn at are the things a
     * design change actually moves, so they are what `key` records; the rest of
     * the placement stays in the hash because the element around the href does.
     */
    const wordmark = async () => {
      const scaled = await sharp(WORDMARK_FILE)
        .resize({ width: MARK_W })
        .png({ palette: true, dither: 0, compressionLevel: 9 })
        .toBuffer();
      const { height } = await sharp(scaled).metadata();
      const href = `data:image/png;base64,${scaled.toString("base64")}`;
      const digest = createHash("sha256").update(readFileSync(WORDMARK_FILE)).digest("hex");
      return {
        height,
        href,
        image: `<image x="${LEFT}" y="${MARK_Y}" width="${MARK_W}" height="${height}" href="${href}"/>`,
        key: `wordmark:${digest.slice(0, 16)}@${MARK_W}`,
      };
    };

    // sharp goes out alongside them because nothing outside this file may
    // import it: the ordering above is only safe as long as this module is the
    // first and only place it is loaded. Anything else a card needs sharp for
    // has to be done from in here.
    return await body({ render, measure, wordmark, sharp });
  } finally {
    rmSync(fontDir, { recursive: true, force: true });
  }
}
