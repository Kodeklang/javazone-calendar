#!/usr/bin/env node
// Draws the site-wide Open Graph share card and writes it to src/icons/og.png.
//
//   npm run og
//
// Committed art, exactly like the icons beside it, and deliberately outside
// the Eleventy build. Setting type through librsvg resolves fonts against the
// host's fontconfig, so the same source rasterises differently on a laptop and
// in Actions - and the hourly workflow deploys whenever the bytes of _site
// change, so a card that re-rendered on every build would invalidate every
// ETag on gh-pages for nothing. Run this by hand when the design or the
// edition changes, and commit the file it writes.
//
// This is the fallback card: the day grids use it, and so does any session
// whose own card scripts/build-session-cards.mjs has not drawn. Everything the
// two cards have in common - the ground, the margins, the wordmark and where
// it sits, the font handling, the raster settings - lives in
// lib/card-renderer.mjs, which that script shares. See the note at the top of
// it for why librsvg has to be told where Montserrat is before it is loaded at
// all.
//
// The words come from src/_data/site.js rather than being typed in, so the
// card and the pages cannot disagree about what the conference is called or
// when it runs: an edition bump in program.json reaches both.

import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  GROUND_BOTTOM,
  GROUND_TOP,
  HEIGHT,
  INK,
  LEFT,
  MUTED,
  WIDTH,
  esc,
  withCardRenderer,
} from "../lib/card-renderer.mjs";
import site from "../src/_data/site.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_PNG = path.join(ROOT, "src/icons/og.png");

// FORMAT_COLOUR.presentation in site.js, and the accent this card has always
// set its second line in.
const CYAN = "#02dfff";

/**
 * The card itself.
 *
 * Everything is placed against the 1200x630 frame by hand: at Slack's rendered
 * width the whole thing is 360px across, so this is really a design for
 * three lines of type at 34, 34 and 13 effective pixels, and the margins are
 * wide enough that a platform trimming a few pixels off the edge takes
 * nothing with it.
 *
 * `mark` is what the renderer's `wordmark()` handed back, unchanged from what
 * a session card draws. Nothing about it is decided here on purpose: the two
 * cards are the same object with different words in it, and a reader who sees
 * the front page unfurl and then a talk unfurl should recognise the second
 * from the first.
 */
function card({ name, label, dates }, mark) {
  const text = (x, y, size, weight, fill, content) =>
    `<text x="${x}" y="${y}" font-family="Montserrat" font-weight="${weight}" ` +
    `font-size="${size}" fill="${fill}">${esc(content)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GROUND_TOP}"/>
      <stop offset="1" stop-color="${GROUND_BOTTOM}"/>
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#ground)"/>

  ${mark.image}

  ${text(LEFT, 352, 112, 800, INK, name)}
  ${text(LEFT, 470, 112, 800, CYAN, label)}
  ${text(LEFT, 554, 44, 600, MUTED, dates)}
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

const chars = [...new Set(Object.values(words).join(""))].join("");
await withCardRenderer(chars, async ({ render, wordmark }) => {
  const png = await render(card(words, await wordmark()));
  writeFileSync(OUT_PNG, png);
  console.log(
    `${path.relative(ROOT, OUT_PNG)} — ${WIDTH}x${HEIGHT}, ` +
      `${Math.round(png.length / 1024)} kB`,
  );
});
