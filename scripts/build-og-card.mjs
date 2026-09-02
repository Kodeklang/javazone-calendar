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
// This is the fallback card: the day grids use it, and so does any session
// whose own card scripts/build-session-cards.mjs has not drawn. The font
// handling and the raster settings both live in lib/card-renderer.mjs, which
// that script shares - see the note at the top of it for why librsvg has to be
// told where Montserrat is before it is loaded at all.
//
// The words come from src/_data/site.js rather than being typed in, so the
// card and the pages cannot disagree about what the conference is called or
// when it runs: an edition bump in program.json reaches both.

import { writeFileSync } from "node:fs";
import path from "node:path";

import { HEIGHT, WIDTH, esc, withCardRenderer } from "../lib/card-renderer.mjs";
import site from "../src/_data/site.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_FILE = path.join(ROOT, "src/icons/og.png");

// The site's own colours: the dark blues are manifest.njk's theme-color and
// background_color, the gradient and the bar geometry come from the app icon
// this card was drawn against, and the cyan is FORMAT_COLOUR.presentation in
// site.js.
const INK = "#ffffff";
const CYAN = "#02dfff";
const MUTED = "#aecfff";
const GROUND_TOP = "#153862";
const GROUND_BOTTOM = "#0a2747";

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

  <!-- The bar-chart mark the app icon used to be, at the size it is actually
       recognised at. The icon itself is JavaZone's Duke now
       (scripts/build-icons.mjs) and this card has not followed it, deliberately:
       src/icons/og.png is committed art, redrawing it moves bytes in _site and
       therefore triggers a deploy, and the alt text in base.njk describes a bar
       chart. Bringing the two back together is a change to make on purpose, not
       a side effect of changing the icon. -->
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

const chars = [...new Set(Object.values(words).join(""))].join("");
await withCardRenderer(chars, async ({ render }) => {
  const png = await render(card(words));
  writeFileSync(OUT_FILE, png);
  console.log(
    `${path.relative(ROOT, OUT_FILE)} — ${WIDTH}x${HEIGHT}, ${Math.round(png.length / 1024)} kB`,
  );
});
