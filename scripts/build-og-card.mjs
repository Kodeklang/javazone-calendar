#!/usr/bin/env node
// Draws the Open Graph share card and writes it to src/icons/og.png.
//
//   npm run og
//
// Committed art, exactly like the icons beside it, and deliberately outside
// the Eleventy build. Setting type through librsvg resolves fonts against the
// host's fontconfig, so the same source rasterises differently on a laptop and
// in Actions - and the hourly workflow deploys whenever the bytes of _site
// change, so a card that re-rendered on every build would invalidate every
// ETag on gh-pages for nothing. Run this by hand when the design or the
// edition changes, and commit the PNG it writes.
//
// The font is the interesting part. Montserrat is vendored only as subsetted
// woff2 for the browser (src/css/fonts), and nothing installs it on the
// machines that build this site, so librsvg on its own would fall back to
// whatever sans-serif fontconfig happens to offer and say nothing about it.
// Instead the same subset-font that lib/fonts.mjs uses converts the two
// weights this card needs to TrueType, writes them to a throwaway directory,
// and points fontconfig at that directory *alone* - the generated fonts.conf
// includes none of the system configuration, so a host that has some other
// Montserrat installed, or no fonts at all, still produces this image. The
// directory is removed when the run ends, whether or not it succeeded.
//
// The words come from src/_data/site.js rather than being typed in, so the
// card and the pages cannot disagree about what the conference is called or
// when it runs: an edition bump in program.json reaches both.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import subsetFont from "subset-font";

import site from "../src/_data/site.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const FONT_SRC = path.join(ROOT, "src/css/fonts");
const OUT_FILE = path.join(ROOT, "src/icons/og.png");

// The 1.91:1 every unfurler asks for, at the resolution they all accept, so
// nothing is scaled up on a retina screen and nothing is cropped away.
const WIDTH = 1200;
const HEIGHT = 630;

// The site's own colours: the dark blues are manifest.njk's theme-color and
// background_color, the gradient and the bar geometry are lifted from
// src/icons/icon.svg, and the cyan is FORMAT_COLOUR.presentation in site.js.
const INK = "#ffffff";
const CYAN = "#02dfff";
const MUTED = "#aecfff";
const GROUND_TOP = "#153862";
const GROUND_BOTTOM = "#0a2747";

// The Latin faces are enough: the card sets a Norwegian month name and an en
// dash, all of which live in Google's "latin" subset. Weight 800 is the
// wordmark weight the design uses for headings, 600 its small labels.
const WEIGHTS = { 800: "montserrat-800-latin.woff2", 600: "montserrat-600-latin.woff2" };

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Fill `dir` with the card's faces as TrueType and a fonts.conf that makes it
 * the only place fontconfig will look.
 *
 * The characters are taken from the text about to be drawn rather than from a
 * fixed list, so a longer date or a renamed edition cannot quietly lose a
 * glyph and leave a hole in the image.
 */
async function installFonts(dir, chars) {
  for (const [weight, file] of Object.entries(WEIGHTS)) {
    const source = readFileSync(path.join(FONT_SRC, file));
    const ttf = await subsetFont(source, chars, { targetFormat: "sfnt" });
    writeFileSync(path.join(dir, `Montserrat-${weight}.ttf`), ttf);
  }

  // fontconfig wants somewhere to write its cache; giving it one inside the
  // throwaway directory keeps it out of the user's home as well as the repo.
  mkdirSync(path.join(dir, "cache"), { recursive: true });
  writeFileSync(
    path.join(dir, "fonts.conf"),
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n` +
      `<fontconfig>\n  <dir>${dir}</dir>\n  <cachedir>${dir}/cache</cachedir>\n</fontconfig>\n`,
  );
}

/**
 * The card itself.
 *
 * Everything is placed against the 1200x630 frame by hand: at Slack's rendered
 * width the whole thing is 360px across, so this is really a design for
 * three lines of type at 34, 34 and 13 effective pixels, and the margins are
 * wide enough that a platform trimming a few pixels off the edge takes
 * nothing with it.
 */
function card({ name, label, dates }) {
  const text = (x, y, size, weight, fill, content) =>
    `<text x="${x}" y="${y}" font-family="Montserrat" font-weight="${weight}" ` +
    `font-size="${size}" fill="${fill}">${esc(content)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GROUND_TOP}"/>
      <stop offset="1" stop-color="${GROUND_BOTTOM}"/>
    </linearGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5c9eff"/>
      <stop offset="1" stop-color="#1868bd"/>
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#ground)"/>

  <!-- The app icon at the size it is actually recognised at, drawn from the
       same geometry as src/icons/icon.svg so the card, the tab and the
       installed app all show one mark. -->
  <svg x="88" y="72" width="128" height="128" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="113" fill="url(#tile)"/>
    <rect x="110.1" y="130.6" width="64" height="151" rx="14" fill="#ffffff"/>
    <rect x="110.1" y="302.1" width="64" height="89.6" rx="14" fill="${CYAN}"/>
    <rect x="224" y="158.7" width="64" height="220.2" rx="14" fill="#ffffff"/>
    <rect x="337.9" y="130.6" width="64" height="99.8" rx="14" fill="#f0567a"/>
    <rect x="337.9" y="250.9" width="64" height="130.6" rx="14" fill="#ffffff"/>
  </svg>

  ${text(88, 352, 112, 800, INK, name)}
  ${text(88, 470, 112, 800, CYAN, label)}
  ${text(88, 554, 44, 600, MUTED, dates)}
</svg>
`;
}

// -------------------------------------------------------------------- main

// Three lines and no more: a share card is read at a glance in a feed, and
// anything past the name, what the link is, and when it happens is noise.
// `label` is Norwegian because everything a crawler sees is (Global Constraint
// 4), and it happens to be the same word in both languages.
const words = {
  name: site.event.name,
  label: "Program",
  dates: site.event.dateRange.no,
};
const svg = card(words);

// Created before the try so that a failure while subsetting still takes the
// directory with it on the way out.
const fontDir = mkdtempSync(path.join(os.tmpdir(), "javazone-og-"));
try {
  await installFonts(fontDir, [...new Set(Object.values(words).join(""))].join(""));

  // fontconfig reads its configuration once, when librsvg first asks it a
  // question, so the environment has to be set before sharp is loaded at all -
  // hence the dynamic import rather than one at the top of the file.
  process.env.FONTCONFIG_FILE = path.join(fontDir, "fonts.conf");
  const { default: sharp } = await import("sharp");

  // No withMetadata(): the file is committed, and a date or a machine name in
  // a PNG chunk would make every regeneration a diff even when the pixels are
  // identical.
  //
  // palette: false is spelled out rather than left to libvips. Quantising this
  // to 256 colours costs no visible quality and saves 8 kB, but it puts a
  // quantiser between the hex values above and the pixels, and on a card whose
  // whole job is to look like the site that is not a trade worth 8 kB.
  //
  // removeAlpha because the ground covers the whole frame: librsvg hands back
  // RGBA regardless, and carrying a channel that is 255 everywhere costs a
  // third of the file for nothing.
  const png = await sharp(Buffer.from(svg))
    .removeAlpha()
    .png({ palette: false, compressionLevel: 9 })
    .toBuffer();

  writeFileSync(OUT_FILE, png);
  console.log(
    `${path.relative(ROOT, OUT_FILE)} — ${WIDTH}x${HEIGHT}, ${Math.round(png.length / 1024)} kB`,
  );
} finally {
  rmSync(fontDir, { recursive: true, force: true });
}
