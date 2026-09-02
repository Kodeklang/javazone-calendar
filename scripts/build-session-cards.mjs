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
// speakers and which of them the card found a photo for, the colours, the font
// size and line breaks the fitter chose for this particular title, and every
// setting either file is encoded with - so a change to the design regenerates
// the whole set on its own, with nothing to remember to bump. It also means a
// speaker changing their Bluesky avatar redraws every card they are on, in the
// same hourly bot commit that refetches the photo: the card carries their face
// now, so a card that did not follow it would be showing the old one.
//
// It is also why RASTER holds every encoder setting a card is made with, down
// to the kernel the wordmark and the photos are scaled by, rather than the
// calls reaching for them themselves: a knob outside the hash could change all
// 155 files while the manifest went on calling them current. Nothing here can
// pass one either, since none of `render`, `wordmark` or `photo` takes an
// override.
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
  PHOTO_D,
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

// The bottom line of facts. It sits 10px lower than it did, into margin the
// card was not using: with the speaker row above it there are now two lines
// down there rather than one, and they have to be far enough apart to read as
// the name and then the time rather than as one four-line block.
const META_SIZE = 44;
const META_BASELINE = 566;

// The speaker row, between the title and the meta line: a circle for each
// speaker with their name beside it. SPEAKER_BOTTOM is where the circles sit
// on, close enough above the meta line to belong to the same lower half of the
// card and far enough that the two do not read as one block.
//
// The name is the third thing a reader looks at, after the title and before
// the time, and it is set to be read in that order: white where the meta line
// is muted, and in the heading weight where the meta line is not, so that it
// carries even at a size below the meta line's. The circle beside it is what
// makes the row a person rather than a third line of type.
//
// NAME_PAD is the gap from a circle to its own name and NAME_SEP the gap to
// the next speaker; the second is twice the first because that difference is
// the only thing telling a reader which name belongs to which face.
const SPEAKER_BOTTOM = 508;
const SPEAKER_GAP = 24;
const NAME_SIZES = [40, 36];
const NAME_WEIGHT = 800;
const NAME_PAD = 20;
const NAME_SEP = 40;

// How large the monogram's initials are set inside that circle.
// src/css/style.css sets 19px in a 60px circle, and this is deliberately
// larger than that, for a reason the two do not share: the page is read at
// the size it is drawn, while a card is read at a third of it, and two
// letters at 19px would be five device pixels in a feed.
const MONO_SIZE = 26;

// The band the title is set in, between the wordmark and the speaker row. Its
// top and bottom are fixed and the block is centred inside them, so a
// one-line title and a four-line title sit around the same optical middle.
//
// The bottom is where the speaker row starts, which is what this change cost
// the title: the band is 282px where it used to be 306, and the top has moved
// up to pay part of that back. A session with no speaker keeps the whole
// space down to SPEAKER_BOTTOM instead - there are none in the 2026 programme,
// but a session losing its last speaker must not leave a hole where the row
// would have been.
const TITLE_TOP = 142;
const TITLE_BOTTOM = SPEAKER_BOTTOM - PHOTO_D - SPEAKER_GAP;
const LINE = 1.14;

// The steps the title is fitted through, largest first. The first two are the
// size src/icons/og.png sets the event's own name at, which is what a share
// card wants to be read at; the rest exist so that a twenty-word title still
// fits inside the band rather than running off the frame.
//
// The ladder ends at 46 rather than at 52 because the speaker row took a line
// out of the band. One title in the 2026 programme - 151 characters, five
// lines at 52px - no longer fits above the row, and the choice for it is
// between a step the ladder did not have and an ellipsis a third of the way
// through the title. 46px is 14 device pixels at the width Slack renders a
// card, which is the size the meta line is already read at, and a title read
// small is worth more than a title that stops.
const SIZES = [112, 96, 82, 70, 60, 52, 46];

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
 * word whole, and the lines it breaks into there. `bottom` is where the band
 * ends: the top of the speaker row on a card that has one, and the row's own
 * bottom edge on a card that does not, so the title takes that space back.
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
 * and given an ellipsis rather than being shrunk further: a step below 46px is
 * smaller than the meta line and stops being read at all at the size a feed
 * renders a card, and a title nobody can read is worse than one that trails
 * off. Nothing in the 2026 programme reaches that point - the longest fits at
 * 46px, in four lines.
 */
function fit(title, width, measure, bottom) {
  const rows = (size) => Math.max(1, Math.floor((bottom - TITLE_TOP) / (size * LINE)));

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

/**
 * How the speaker row is laid out for a given cast: at what size the names
 * are set, and whether the circles fit beside them.
 *
 * A row of circle-and-name pairs is what the row is for, and 147 of the 155
 * sessions take it at the first size. The rest are pairs of Norwegian names
 * long enough that the row would run off the card - "Synne Markmanrud" and
 * "Vilde Aurora Halle Tvedten" is 45 characters of 40px heading weight, which
 * is wider than the frame before either circle is drawn. Those step down one
 * size, and if that is still not enough the circles go rather than the type:
 * a circle small enough to fit two of those names is smaller than the initials
 * inside it can be read at, so it would be a decoration standing in for a
 * face, while the names alone are still the fact the card is there to carry.
 * Four sessions keep their circles by stepping down, and four set names alone.
 *
 * The last resort is the shorthand the day grid uses for the same problem,
 * `${first} +${n - 1}`. No session in the 2026 programme reaches it - the
 * widest row of any kind is 991px of 1024 - and it is here so that a cast that
 * outgrows the card loses a name to a rule rather than to the edge of the
 * frame, silently, the way librsvg would draw it.
 */
function speakerRow(speakers, width, measure) {
  const names = speakers.map((p) => p.name);
  const pairs = (size) =>
    speakers.reduce((w, p) => w + PHOTO_D + NAME_PAD + measure(p.name, size, NAME_WEIGHT), 0) +
    (speakers.length - 1) * NAME_SEP;

  for (const size of NAME_SIZES) if (pairs(size) <= width) return { size, circles: true };

  const joined = names.join(" · ");
  for (const size of NAME_SIZES) {
    if (measure(joined, size, NAME_WEIGHT) <= width) return { size, circles: false, text: joined };
  }
  return {
    size: NAME_SIZES.at(-1),
    circles: false,
    text: names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0],
  };
}

/**
 * The circle a speaker is drawn in, at `x`, centred on `cy`: their photo where
 * there is one, and their initials where there is not.
 *
 * The two are the same circle, at the same size, in the same place, which is
 * the whole point. Only 56 of the 181 speakers in the programme have a photo
 * to be had - Sleeping Pill publishes none and Bluesky is the one link that
 * resolves to one - so the monogram is not a placeholder waiting to be filled
 * but what most cards will always show, and src/css/style.css gives the two
 * identical geometry on the page for exactly this reason. A card drawing them
 * differently would undo that on the surface where more people see it. Any
 * change to one of the two below belongs in both, and in that stylesheet.
 *
 * `art` is what the renderer's `photo()` returned, or null.
 */
function speakerCircle(speaker, art, x, cy, colour, index) {
  const r = PHOTO_D / 2;
  const cx = x + r;
  // Inside the diameter rather than centred on it, so the ring and the photo
  // it holds occupy exactly the PHOTO_D box the layout measured.
  const ring =
    `<circle cx="${cx}" cy="${cy}" r="${r - 0.5}" fill="none" ` +
    `stroke="${INK}" stroke-opacity="0.25"/>`;

  if (art) {
    const clip = `sp${index}`;
    return (
      `<clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>\n  ` +
      `<image x="${x}" y="${cy - r}" width="${PHOTO_D}" height="${PHOTO_D}" ` +
      `preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})" href="${art.href}"/>\n  ` +
      ring
    );
  }
  // The stylesheet tints the monogram's disc *down* from the panel behind it.
  // Here the ground is already the darkest thing on the card, so the same step
  // away from it is a step up: a disc that reads at the size a feed renders
  // this, which is what gives a monogram the same weight as the photograph
  // that may be standing next to it.
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${INK}" fill-opacity="0.08"/>\n  ` +
    ring +
    `\n  <text x="${cx}" y="${Math.round(cy + MONO_SIZE * 0.36)}" text-anchor="middle" ` +
    `font-family="Montserrat" font-weight="800" font-size="${MONO_SIZE}" ` +
    `fill="${colour}">${esc(speaker.initials)}</text>`
  );
}

/**
 * The whole speaker row, as SVG, or the empty string for a session with none.
 *
 * The names sit on one baseline and the circles on one centre line, and the
 * row is measured left to right from the widths the names actually set at -
 * the same `measure` the title is fitted with - rather than from a column
 * grid, because a two-speaker row has to close up around a short name instead
 * of leaving a hole where a long one would have been.
 */
function speakerBlock(speakers, art, colour, measure) {
  if (!speakers.length) return "";

  const row = speakerRow(speakers, RIGHT - LEFT, measure);
  const cy = SPEAKER_BOTTOM - PHOTO_D / 2;
  // Half a cap height below the centre of the circles, which is what puts the
  // name's own middle on the same line as the face beside it.
  const baseline = Math.round(cy + row.size * 0.35);
  const name = (x, text) =>
    `<text x="${x}" y="${baseline}" font-family="Montserrat" font-weight="${NAME_WEIGHT}" ` +
    `font-size="${row.size}" fill="${INK}">${esc(text)}</text>`;

  if (!row.circles) return name(LEFT, row.text);

  const out = [];
  let x = LEFT;
  for (const [i, speaker] of speakers.entries()) {
    out.push(speakerCircle(speaker, art[i], Math.round(x), cy, colour, i));
    x += PHOTO_D + NAME_PAD;
    out.push(name(Math.round(x), speaker.name));
    x += measure(speaker.name, row.size, NAME_WEIGHT) + NAME_SEP;
  }
  return out.join("\n  ");
}

/**
 * The card, as SVG. `mark` is what the renderer's `wordmark()` handed back,
 * and `art` the same for each speaker's photo, in the speakers' own order and
 * null wherever there is none.
 */
function card({ title, facts, formatName, colour, mark, speakers, art }, measure) {
  // A session with no speaker has no row to leave room for, and the title
  // takes the space back rather than being set high with a gap under it.
  const bottom = speakers.length ? TITLE_BOTTOM : SPEAKER_BOTTOM;
  const { size, lines } = fit(title, RIGHT - LEFT, measure, bottom);

  // The block is centred in the band, so the gap above a short title matches
  // the gap below it instead of leaving it stranded under the wordmark.
  const top = TITLE_TOP + ((bottom - TITLE_TOP) - lines.length * size * LINE) / 2;
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

  ${speakerBlock(speakers, art, colour, measure)}

  <text x="${LEFT}" y="${META_BASELINE}" font-family="Montserrat" font-weight="600"
        font-size="${META_SIZE}" fill="${MUTED}">${esc(facts.day)} <tspan fill="${colour}">${esc(facts.time)}</tspan> · ${esc(facts.room)}</text>
</svg>
`;
}

// -------------------------------------------------------------------- main

// Every character any card in this run may set, so the font the cards are
// drawn with is the same whether one of them is being redrawn or all of them.
// A speaker's initials are in here as well as their name, because `initials`
// upper-cases what it takes and a name whose first letter is only ever
// lower-case elsewhere would otherwise have no glyph. The last four are the
// card's own punctuation rather than the programme's: the separator between
// time and room and between two names, the ellipsis a truncated title ends on,
// and the plus of the shorthand a cast too wide for the row falls back to.
// None occurs in a title, and a glyph the subset does not carry is drawn as an
// empty box with nothing said about it.
const chars = [
  ...new Set(
    site.sessions
      .map(
        (s) =>
          `${s.title}${s.formatName.no}${s.shareFacts.day}${s.shareFacts.time}${s.shareFacts.room}` +
          s.speakers.map((p) => `${p.name}${p.initials}`).join(""),
      )
      .join("") + " ·…+",
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

const entries = await withCardRenderer(chars, async ({ render, measure, wordmark, photo }) => {
  const mark = await wordmark();

  return pool(site.sessions, async (session) => {
    const file = `${session.slug}.png`;
    try {
      // site.js gives a speaker's photo as the root-relative URL the pages
      // load it from, and src is where those are served out of, so this is the
      // same file the detail page shows rather than a second copy of it.
      // Loaded for every session on every run, not only for the ones about to
      // be redrawn, because the hash below is taken over the finished card and
      // there is no finished card without them.
      const art = await Promise.all(
        session.speakers.map((p) => (p.photo ? photo(path.join(ROOT, "src", p.photo.url)) : null)),
      );
      const svg = card(
        {
          title: session.title,
          facts: session.shareFacts,
          formatName: session.formatName.no,
          colour: session.colour,
          mark,
          speakers: session.speakers,
          art,
        },
        measure,
      );
      // Every embedded bitmap swapped for the stand-in key that stands for its
      // source rather than for the machine that scaled it - see `wordmark` and
      // `photo` in lib/card-renderer.mjs. split/join rather than replace
      // because replace would take only the first of them.
      const keyed = [mark, ...art.filter(Boolean)].reduce(
        (s, image) => s.split(image.href).join(image.key),
        svg,
      );
      const hash = createHash("sha256")
        .update(keyed)
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
