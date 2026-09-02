#!/usr/bin/env node
// Draws the app icon and the favicon from the JavaZone Duke, and writes them
// to src/icons/.
//
//   npm run icons
//
// Committed art, like src/icons/og.png beside it, and deliberately outside the
// Eleventy build for the same reason: the hourly workflow deploys whenever the
// bytes of _site change, and an icon re-rendered on every build would
// invalidate every ETag on gh-pages for a picture nobody changed. Run this by
// hand when the mark changes, and commit the PNGs it writes.
//
// Unlike the share cards this sets no type, so none of lib/card-renderer.mjs
// applies - the font installation and the advance-width measurement in there
// exist solely so librsvg has a Montserrat to set headings in, and there is
// nothing here for it to set. sharp is therefore imported normally rather than
// after FONTCONFIG_FILE is in place.
//
// Duke is JavaZone's own mascot, used here with the organisers' permission. He
// is vendored as src/icons/javazone-duke.png rather than fetched, because
// upstream serves him under a content-hashed filename that changes on every
// deploy of theirs - a build that fetched him would break without warning. The
// vendored file is
//
//   https://2026.javazone.no/assets/jz26-logo-duke-transparent-large-t-zkSk3u.png
//
// cropped to { left: 318, top: 11, width: 252, height: 221 }, which is his own
// alpha bounding box ending on the last row before the pink wordmark below him
// starts. He is the whole of the vendored file, so nothing downstream has to
// know where the wordmark was. The separate
// src/icons/javazone-wordmark.png is the other half of the same logo and
// belongs to the session share cards; the two are not interchangeable.

import { writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "src/icons/javazone-duke.png");
const OUT_DIR = path.join(ROOT, "src/icons");

// The gradient the retired src/icons/icon.svg used, kept unchanged so an
// installed app that updates to this icon still sits on the tile it sat on
// before. It is also the only one of the site's three blues Duke survives, and
// that was checked rather than assumed: he is a black-hatted mascot in front of
// a near-white shell, and drawn on manifest.njk's #153863 or #0a2747 the hat
// and the trident sink into the ground and leave the shell doing all the work,
// which at 32px is a white blob with a red dot on it. On this lighter blue the
// hat is the shape that carries, which is the one that looks like Duke.
const GROUND_TOP = "#5c9eff";
const GROUND_BOTTOM = "#1868bd";

// The corner radius the retired icon drew, as a fraction of the tile. Only the
// two manifest icons keep it: iOS and Android both mask what they are given,
// and rounding a tile that is about to be rounded again leaves the ground
// showing through at the corners.
const RADIUS = 113 / 512;

// Duke entire, which is the whole of the vendored file.
const FULL = { left: 0, top: 0, width: 252, height: 221 };

// Hat and nose only, for the sizes where the whole mascot cannot survive.
// Downscaled to 16px the trident is a smear, the shell is a grey halo, the
// crate and the blue flame are two more smudges, and what is left is
// unreadable. This box keeps the black hat and the red nose - the two shapes
// with enough contrast against the ground to still be shapes at 16px - and
// throws the rest away. Square, so it fills the tile exactly: at 16px a margin
// costs a tenth of the width, and the transparent corners of the crop already
// let enough ground through to frame it.
const CLOSE = { left: 40, top: 38, width: 140, height: 140 };

/**
 * The ground: a vertical gradient, optionally with the corners rounded away.
 *
 * `radius` is a fraction of the tile rather than pixels so the corner is the
 * same shape at every size.
 */
function ground(size, radius) {
  const corner = radius ? ` rx="${(size * radius).toFixed(2)}"` : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GROUND_TOP}"/>
      <stop offset="1" stop-color="${GROUND_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}"${corner} fill="url(#g)"/>
</svg>
`,
  );
}

/**
 * One tile: `crop` of Duke, scaled to `fraction` of the tile, over the ground.
 *
 * `fraction` is of the *tile*, and sizes the crop's longer side, so the same
 * number means the same visual weight whether the crop is square or not.
 *
 * `opaque` drops the alpha channel. The two rounded tiles keep theirs, because
 * the alpha is what cuts their corners. The apple-touch-icon must not have one
 * at all: iOS composites it onto its own tile and paints transparency black
 * rather than showing what is behind it. The favicons and the maskable icon
 * have nothing transparent left to carry, so dropping the channel is a third
 * of the file for free.
 */
async function tile({ size, crop, fraction, radius = 0, opaque = false }) {
  const scale = (size * fraction) / Math.max(crop.width, crop.height);
  const width = Math.round(crop.width * scale);
  const height = Math.round(crop.height * scale);

  const duke = await sharp(SOURCE)
    .extract(crop)
    .resize(width, height, { kernel: "lanczos3" })
    .png()
    .toBuffer();

  let out = sharp(ground(size, radius)).composite([
    {
      input: duke,
      left: Math.round((size - width) / 2),
      top: Math.round((size - height) / 2),
    },
  ]);
  if (opaque) out = out.removeAlpha();

  // No withMetadata(): these files are committed, and a timestamp or a machine
  // name in a PNG chunk would make every regeneration a diff even when not one
  // pixel moved.
  //
  // No palette, unlike the session cards, and the difference is measured rather
  // than assumed. The cards quantise for free because their ground is nearly
  // all of the card and steps through only 54 levels, so libimagequant spends
  // the palette on it and comes back bit-identical. Here Duke spends it
  // instead: quantising icon-512 takes the ground's 143 levels down to 47 and
  // moves the cyan flame by as much as 34 of 255, which is a visible shift on
  // the one saturated thing in the picture. It saves 90 kB and it is not worth
  // 90 kB.
  //
  // adaptiveFiltering is, though. It changes no pixel at all - PNG row filters
  // are lossless - and choosing one per row rather than none takes the 512 from
  // 176 kB to 126 kB, which is a third off the largest thing the service worker
  // precaches. It is off by default in sharp because it costs encode time,
  // which a script run by hand does not care about.
  return out.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

// The set, and why each one is shaped the way it is.
//
// 16 and 32 are the favicon, at the two sizes a browser actually asks for, and
// they are the only two drawn from the close crop. They are opaque squares
// because a tab strip is not a launcher: nothing masks them, and a rounded
// corner at 16px spends whole pixels on a shape too small to read as a corner.
//
// 180 is the apple-touch-icon, opaque and square for the same reason it is
// square rather than rounded: iOS composites it onto its own tile, rounds it
// itself, and paints any transparency black.
//
// 192 and 512 are the manifest's, and keep the retired icon's rounded corner
// because nothing masks a "purpose: any" icon - what is drawn is what is shown.
//
// The maskable 512 is the odd one. Android may cut it to a circle, a squircle
// or a rounded square, so the ground runs to all four edges and Duke is inset
// until his whole bounding box fits inside the central circle of 80% diameter.
// A 252x221 box has a diagonal of 335, and that fits a circle 410px across only
// at 307px wide, which is 60% of the tile. Every corner of that box is occupied
// - the trident in one, his shadow in the other - so there is no slack to be
// had by centring him on his ink rather than on his box: it buys 1%. He is
// therefore smaller here than on the icon beside him, and is meant to be. The
// alternative is a mascot with his trident cut off on every launcher that
// masks to a circle.
const ICONS = [
  { file: "icon-16.png", size: 16, crop: CLOSE, fraction: 1, opaque: true },
  { file: "icon-32.png", size: 32, crop: CLOSE, fraction: 1, opaque: true },
  { file: "icon-180.png", size: 180, crop: FULL, fraction: 0.86, opaque: true },
  { file: "icon-192.png", size: 192, crop: FULL, fraction: 0.86, radius: RADIUS },
  { file: "icon-512.png", size: 512, crop: FULL, fraction: 0.86, radius: RADIUS },
  { file: "icon-maskable-512.png", size: 512, crop: FULL, fraction: 0.6, opaque: true },
];

for (const { file, ...spec } of ICONS) {
  const png = await tile(spec);
  writeFileSync(path.join(OUT_DIR, file), png);
  console.log(`src/icons/${file} — ${spec.size}x${spec.size}, ${(png.length / 1024).toFixed(1)} kB`);
}
