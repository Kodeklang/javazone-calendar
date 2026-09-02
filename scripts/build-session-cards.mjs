#!/usr/bin/env node
// Draws one Open Graph share card per session into src/cards, as a 1200x630
// PNG, plus a manifest at src/_data/cards.json that program.11tydata.js reads.
//
// One format, because base.njk emits one og:image - a repeated og:image is not
// a format negotiation, whatever it looks like. See lib/card-renderer.mjs's
// RASTER and the share-cards section of the README.
//
//   npm run cards        (after scripts/fetch-program.mjs)
//
// src/icons/og.png remains the fallback and is what the day grids unfurl with.
// This is the card a single talk gets, so that a link to one in a Slack
// channel arrives with its own title on it rather than with the site's.
//
// Committed art, like the speaker photos beside it and for the same reason:
// the git diff is the change detector. Nothing about the build may depend on
// the machine it runs on - librsvg resolves fonts against the host's
// fontconfig, and the hourly workflow deploys whenever the bytes of _site
// change - so the cards are rendered here, committed to main, and copied
// through untouched. That only works if a run over an unchanged programme
// rewrites nothing at all, which is what the manifest is for: it records a
// hash of the drawing instructions for each card, and a card whose hash has
// not moved, and whose file is still on disk, is left alone.
//
// The hash is taken over the finished SVG and lib/card-renderer.mjs's RASTER,
// rather than over the fields the SVG was built from. That covers strictly
// more - the title, format, day, time and room, but also the wordmark, the
// colours, the font size and line breaks the fitter chose for this particular
// title, and every setting either file is encoded with - so a change to the
// design regenerates the whole set on its own, with nothing to remember to
// bump. It is also why RASTER holds every encoder setting a card is made with,
// down to the kernel the wordmark is scaled by, rather than the calls reaching
// for them themselves: a knob outside the hash could change all 155 files
// while the manifest went on calling them current. Nothing here can pass one
// either, since neither `render` nor `wordmark` takes an override.
//
// Nothing here belongs in the service worker's precache; see the note at
// SHELL in src/sw.njk.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  GROUND_BOTTOM,
  GROUND_TOP,
  HEIGHT,
  INK,
  LEFT,
  MARK_Y,
  MUTED,
  RASTER,
  RIGHT,
  WIDTH,
  esc,
  withCardRenderer,
} from "../lib/card-renderer.mjs";
import site from "../src/_data/site.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const CARD_DIR = path.join(ROOT, "src/cards");
const MANIFEST_FILE = path.join(ROOT, "src/_data/cards.json");

// The band the title is set in, between the wordmark and the meta line. Its
// top and bottom are fixed and the block is centred inside them, so a
// one-line title and a five-line title sit around the same optical middle.
const TITLE_TOP = 200;
const TITLE_BOTTOM = 506;
const LINE = 1.14;

// The steps the title is fitted through, largest first. The first two are the
// size src/icons/og.png sets the event's own name at, which is what a share
// card wants to be read at; the rest exist so that a twenty-word title still
// fits inside the band rather than running off the frame.
const SIZES = [112, 96, 82, 70, 60, 52];

const META_SIZE = 44;
const META_BASELINE = 556;

// Rendering all 155 is a couple of minutes of libvips; running a few at once
// takes it to well under one. Results are collected in the input's order
// rather than in completion order, so an unchanged programme keeps producing
// an identically ordered manifest.
const CONCURRENCY = 4;

// A card that fails to rasterise is not a reason to prune every other card off
// the disk. Past this share of failures the run writes nothing and exits
// non-zero, exactly as scripts/fetch-photos.mjs does for a Bluesky outage.
const MAX_ERROR_RATE = 0.5;

/** Run `worker` over every item, at most CONCURRENCY at a time, in order. */
async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runner = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, runner));
  return results;
}

/**
 * Break `text` into lines no wider than `width`, set at `size` in weight 800,
 * and say whether a word had to be cut through to manage it.
 *
 * Greedy, which is what a headline wants: the first line should be as full as
 * it can be, because that is the line a reader's eye lands on.
 *
 * A word too wide for a line of its own is broken mid-word rather than allowed
 * off the edge, and `broke` is how `fit` finds out. That flag matters more here
 * than it would in English: Norwegian writes a noun phrase as one word, and
 * "leveransekjedesikkerhet" or "sanntidsinformasjon" is wider at 112px than the
 * whole card. Splitting one reads as a typo, so the break is a last resort and
 * the caller is told it happened rather than handed a plausible-looking result.
 */
function wrap(text, size, width, measure) {
  const fits = (s) => measure(s, size, 800) <= width;
  const lines = [];
  let line = "";
  let broke = false;

  const flush = () => {
    if (line) lines.push(line);
    line = "";
  };

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && fits(`${line} ${word}`)) {
      line = `${line} ${word}`;
      continue;
    }
    flush();
    if (fits(word)) {
      line = word;
      continue;
    }
    broke = true;
    let rest = word;
    while (rest && !fits(rest)) {
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  flush();

  return { lines, broke };
}

/**
 * The largest step from SIZES at which `title` fits the title band with every
 * word whole, and the lines it breaks into there.
 *
 * Filling the band is not enough on its own to accept a step. A step that only
 * fits because `wrap` cut a word in half satisfies the line count exactly as
 * well as one that did not, and four sessions in the 2026 programme landed
 * there - "Leveransekjedesikk / erhet", "Erstatningssyste / mfella". All four
 * fit whole a step or two further down, so a step that broke a word is set
 * aside and the ladder is walked to the end; the broken one is only used if no
 * step can hold the longest word at all, which is the URL-shaped token this
 * guards against and no title today.
 *
 * A title that will not fit even at the smallest step is cut at a word boundary
 * and given an ellipsis rather than being shrunk further: below about 50px the
 * title stops being readable at the size a feed renders a card, and a title
 * nobody can read is worse than one that trails off. Nothing in the 2026
 * programme reaches that point - the longest fits at 52px.
 */
function fit(title, width, measure) {
  const rows = (size) => Math.max(1, Math.floor((TITLE_BOTTOM - TITLE_TOP) / (size * LINE)));

  let broken = null;
  for (const size of SIZES) {
    const { lines, broke } = wrap(title, size, width, measure);
    if (lines.length > rows(size)) continue;
    if (!broke) return { size, lines };
    // The largest step that fits at all, in case every step has to break this
    // word. Held rather than returned, so that a smaller whole one still wins.
    broken ??= { size, lines };
  }
  if (broken) return broken;

  const size = SIZES.at(-1);
  const lines = wrap(title, size, width, measure).lines.slice(0, rows(size));
  let last = lines.at(-1).split(" ");
  while (last.length > 1 && measure(`${last.join(" ")}…`, size, 800) > width) last.pop();
  lines[lines.length - 1] = `${last.join(" ")}…`;
  return { size, lines };
}

/** The card, as SVG. `mark` is what the renderer's `wordmark()` handed back. */
function card({ title, facts, formatName, colour, mark }, measure) {
  const { size, lines } = fit(title, RIGHT - LEFT, measure);

  // The block is centred in the band, so the gap above a short title matches
  // the gap below it instead of leaving it stranded under the wordmark.
  const top = TITLE_TOP + ((TITLE_BOTTOM - TITLE_TOP) - lines.length * size * LINE) / 2;
  const baseline = (i) => Math.round(top + size * (0.82 + i * LINE));

  const title_ = lines
    .map(
      (line, i) =>
        `<text x="${LEFT}" y="${baseline(i)}" font-family="Montserrat" font-weight="800" ` +
        `font-size="${size}" fill="${INK}">${esc(line)}</text>`,
    )
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GROUND_TOP}"/>
      <stop offset="1" stop-color="${GROUND_BOTTOM}"/>
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#ground)"/>

  <!-- The format's colour along the left edge, which is where the grid draws
       it too: the same talk's card in src/css/style.css carries this exact
       border, so the unfurl and the programme agree at a glance. -->
  <rect width="14" height="${HEIGHT}" fill="${colour}"/>

  ${mark.image}
  <text x="${RIGHT}" y="${MARK_Y + Math.round(mark.height / 2) + 13}" text-anchor="end"
        font-family="Montserrat" font-weight="600" font-size="36" fill="${colour}">${esc(formatName)}</text>

  ${title_}

  <text x="${LEFT}" y="${META_BASELINE}" font-family="Montserrat" font-weight="600"
        font-size="${META_SIZE}" fill="${MUTED}">${esc(facts.day)} <tspan fill="${colour}">${esc(facts.time)}</tspan> · ${esc(facts.room)}</text>
</svg>
`;
}

// -------------------------------------------------------------------- main

// Every character any card in this run may set, so the font the cards are
// drawn with is the same whether one of them is being redrawn or all of them.
// The last two are the card's own punctuation rather than the programme's: the
// separator between time and room, and the ellipsis a truncated title ends on.
// Neither occurs in a title, and a glyph the subset does not carry is drawn as
// an empty box with nothing said about it.
const chars = [
  ...new Set(
    site.sessions
      .map((s) => `${s.title}${s.formatName.no}${s.shareFacts.day}${s.shareFacts.time}${s.shareFacts.room}`)
      .join("") + " ·…",
  ),
].join("");

const previous = await readFile(MANIFEST_FILE, "utf8")
  .then((s) => JSON.parse(s).cards ?? {})
  .catch(() => ({}));

await mkdir(CARD_DIR, { recursive: true });
// .webp is still matched although nothing writes one any more. This set is
// both what "is the card still there" is answered from and what the prune at
// the end sweeps: a WebP left behind by a checkout that predates the move to a
// single og:image is not a foreign file to step around, it is a card Eleventy
// would go on publishing with nothing left to reference it.
const onDisk = new Set(
  (await readdir(CARD_DIR).catch(() => [])).filter((f) => /\.(png|webp)$/.test(f)),
);

let drawn = 0;
let bytes = 0;
const errors = [];

const entries = await withCardRenderer(chars, async ({ render, measure, wordmark }) => {
  const mark = await wordmark();

  return pool(site.sessions, async (session) => {
    const file = `${session.slug}.png`;
    try {
      const svg = card(
        {
          title: session.title,
          facts: session.shareFacts,
          formatName: session.formatName.no,
          colour: session.colour,
          mark,
        },
        measure,
      );
      const hash = createHash("sha256")
        .update(svg.replace(mark.href, mark.key))
        .update(JSON.stringify(RASTER))
        .digest("hex")
        .slice(0, 16);

      // The file has to be there, not just the manifest's word for it: a
      // checkout whose card was never committed, or lost to a half-applied
      // merge, must redraw rather than publish an og:image that 404s.
      const before = previous[session.id];
      const current = before?.hash === hash && before.file === file && onDisk.has(file);
      if (current) return [session.id, before];

      const png = await render(svg);
      await writeFile(path.join(CARD_DIR, file), png);
      drawn++;
      bytes += png.length;
      return [session.id, { file, hash }];
    } catch (err) {
      errors.push(`${session.title}: ${err.message}`);
      // Keep whatever the last good run drew rather than letting the prune
      // below take a card away over a transient failure.
      const kept = previous[session.id];
      return kept && onDisk.has(kept.file) ? [session.id, kept] : null;
    }
  });
});

for (const line of errors) console.warn(`  ! ${line}`);

if (site.sessions.length && errors.length > site.sessions.length * MAX_ERROR_RATE) {
  throw new Error(`${errors.length} of ${site.sessions.length} cards failed — refusing to write`);
}

// Sorted, so an unchanged programme keeps producing identical bytes.
const cards = Object.fromEntries(entries.filter(Boolean).sort(([a], [b]) => a.localeCompare(b)));

// Paths and hashes only. The 1200x630 every card is drawn at is decided in
// lib/card-renderer.mjs and stated again in base.njk's og:image:width and
// :height, and recording it here as well only offered a third answer that
// nothing ever read.
await writeFile(MANIFEST_FILE, JSON.stringify({ cards }, null, 2) + "\n");

// Anything the manifest no longer claims: a session off the programme, one
// whose title was edited enough to change its slug and so its filename, or a
// WebP from before the move to a single og:image.
const keep = new Set(Object.values(cards).map((c) => c.file));
const stale = [...onDisk].filter((f) => !keep.has(f)).sort();
for (const file of stale) await unlink(path.join(CARD_DIR, file));

console.log(
  `${Object.keys(cards).length} cards for ${site.sessions.length} sessions ` +
    `(${drawn} drawn${bytes ? `, ${Math.round(bytes / 1024)} kB` : ""}, ` +
    `${Object.keys(cards).length - drawn} unchanged` +
    `${stale.length ? `, ${stale.length} pruned` : ""}` +
    `${errors.length ? `, ${errors.length} failed` : ""})`,
);
