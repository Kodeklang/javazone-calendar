#!/usr/bin/env node
// Pulls the JavaZone programme from the Sleeping Pill API and writes it to
// src/_data/program.json. See docs/sleepingpill-api.md for the endpoint, the
// session shape, and everything it does not guarantee.
//
// One request gets the whole programme:
//
//   GET https://sleepingpill.javazone.no/public/allSessions/javazone_2026
//
// The output must be byte-stable for an unchanged programme: the deploy
// pipeline uses "did the bytes change?" as its change detector, so every
// collection is sorted and nothing time-dependent is ever written.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Pinned rather than discovered. GET /public/allSessions lists every edition,
// so `javazone_2027` could be picked up automatically - but it appears on that
// index as soon as the organisers create it, months before it has a programme,
// and switching to it would empty this calendar while 2026 was still running.
// Bump this by hand, or override for a one-off build.
const SLUG = process.env.JZ_SLUG ?? "javazone_2026";
const API = `https://sleepingpill.javazone.no/public/allSessions/${SLUG}`;
const UA = "javazone-calendar/1.0 (+https://javazone.kodeklang.dev)";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_FILE = path.join(ROOT, "src/_data/program.json");

// The venue is not in the payload. Nothing upstream carries it, so it is
// stated here and shown on the day grid rather than invented per session.
const VENUE = "NOVA Spektrum, Lillestrøm";

const MIN_SESSIONS = 50; // 2026 has 155; anything near zero is a broken fetch

// Display names for the formats seen so far. `format` is an open enum, so an
// unknown value falls through to the raw string rather than dropping the
// session - see docs/sleepingpill-api.md §3.1.
const FORMAT_NAME = {
  presentation: { no: "Foredrag", en: "Presentation" },
  "lightning-talk": { no: "Lyntale", en: "Lightning talk" },
  workshop: { no: "Workshop", en: "Workshop" },
};

const LANGUAGE_NAME = {
  no: { no: "Norsk", en: "Norwegian" },
  en: { no: "Engelsk", en: "English" },
};

// ------------------------------------------------------------------- text

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;");

// Abstracts and bios are plain text that frequently carries a bare URL. Trailing
// punctuation is left out of the link so a sentence-ending full stop does not
// become part of the href.
const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

/** Escape, then turn bare URLs into links. Output is safe for `| safe`. */
function linkify(raw) {
  let out = "";
  let last = 0;
  for (const m of raw.matchAll(URL_RE)) {
    out += escapeHtml(raw.slice(last, m.index));
    const href = escapeHtml(m[0]);
    out += `<a href="${href}" rel="noopener noreferrer" target="_blank">${href}</a>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(raw.slice(last));
}

/**
 * Split plain text into paragraph HTML strings. A blank line starts a new
 * paragraph; a single newline inside one is a soft break, because upstream
 * uses both and collapsing them all would run bulleted lists together.
 */
function paragraphs(raw) {
  if (!raw) return [];
  return raw
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((chunk) => linkify(chunk.trim()).replace(/\n/g, "<br>"))
    .filter(Boolean);
}

/**
 * Workshop prerequisites are setup instructions: fenced code blocks, indented
 * commands, numbered steps. Reflowing them into paragraphs destroys them, so
 * the whole thing stays one block with its line breaks intact, rendered
 * `white-space: pre-wrap`.
 */
function preformatted(raw) {
  if (!raw) return null;
  const text = raw.replace(/\r\n?/g, "\n").trim();
  // Some entries are placeholders rather than instructions.
  if (!text || /^(\.{2,}|n\/?a|tba|tbd)$/i.test(text)) return null;
  return linkify(text);
}

// NFD strips the accents that decompose; the letters that do not - the Polish
// and Nordic ones that turn up in speaker names - are spelled out first, so
// "Piotr Przybyl" keeps its l rather than losing it to the character class.
const TRANSLITERATE = { æ: "ae", ø: "o", å: "a", ł: "l", đ: "d", ð: "d", þ: "th", ß: "ss" };

const slugify = (s) =>
  s.toLowerCase()
    .replace(/[æøåłđðþß]/g, (c) => TRANSLITERATE[c])
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** A social handle, with or without upstream's inconsistent leading "@". */
const handle = (s) => {
  const clean = (s ?? "").trim().replace(/^@+/, "");
  return clean || null;
};

// ---------------------------------------------------------------- fetching

async function fetchProgramme() {
  const res = await fetch(API, {
    headers: { "user-agent": UA, "accept-encoding": "gzip" },
  });
  // Errors come back as a Jetty HTML page, so the status is the only thing
  // worth trusting - never try to parse the body of a non-200.
  if (!res.ok) throw new Error(`${API}: HTTP ${res.status}`);
  const body = await res.json();
  if (!body || !Array.isArray(body.sessions)) {
    throw new Error(`${API}: response has no sessions array`);
  }
  return body.sessions;
}

// ----------------------------------------------------------------- parsing

/** The fields the site cannot render a session without. */
const usable = (s) =>
  s && typeof s === "object" &&
  s.id && s.title && s.startTimeZulu && s.endTimeZulu && s.room;

function normalise(raw) {
  const startUtc = new Date(raw.startTimeZulu).toISOString();
  const endUtc = new Date(raw.endTimeZulu).toISOString();
  const format = String(raw.format ?? "").trim() || "presentation";
  const language = String(raw.language ?? "").trim().toLowerCase() || null;

  return {
    id: raw.id,
    title: String(raw.title).trim(),
    // Local wall-clock is the authority on which day a session belongs to; the
    // UTC instant is the authority on when it happens. Both are needed, and
    // startTime is already Europe/Oslo - see docs/sleepingpill-api.md §4.
    dayId: String(raw.startTime ?? "").slice(0, 10) || startUtc.slice(0, 10),
    roomName: String(raw.room).trim(),
    startUtc,
    endUtc,
    // Derived from the timestamps rather than read from `length`: they are the
    // authority, and a rescheduled session could leave `length` behind.
    durationMin: Math.round((Date.parse(endUtc) - Date.parse(startUtc)) / 60000),
    format,
    language,
    keywords: String(raw.suggestedKeywords ?? "")
      .split(",").map((k) => k.trim()).filter(Boolean),
    audience: String(raw.intendedAudience ?? "").trim(),
    description: paragraphs(raw.abstract ?? ""),
    prerequisites: preformatted(raw.workshopPrerequisites),
    // A bare Vimeo id, and only after the conference.
    video: /^\d+$/.test(String(raw.video ?? "")) ? String(raw.video) : null,
    speakers: (Array.isArray(raw.speakers) ? raw.speakers : [])
      .filter((p) => p && typeof p.name === "string" && p.name.trim()),
  };
}

/**
 * Collapse the speaker objects repeated across sessions into one list.
 *
 * There is no speaker id upstream and no photo, so exact name match is the
 * only thing to correlate on. Two different people sharing a name would merge;
 * that is upstream's ambiguity, not something this can resolve.
 *
 * Where the same name carries different text, the longest bio wins and the
 * links are merged - picked deterministically so an unchanged programme keeps
 * producing identical bytes.
 */
function collectSpeakers(sessions) {
  const byName = new Map();

  for (const session of sessions) {
    for (const p of session.speakers) {
      const name = p.name.trim();
      const entry = byName.get(name) ?? { name, bios: [], links: {} };
      const bio = String(p.bio ?? "").trim();
      if (bio) entry.bios.push(bio);
      for (const [key, value] of [
        ["linkedin", (p.linkedin ?? "").trim() || null],
        ["bluesky", handle(p.bluesky)],
        ["twitter", handle(p.twitter)],
      ]) {
        if (value) (entry.links[key] ??= new Set()).add(value);
      }
      byName.set(name, entry);
    }
  }

  const slugs = new Map();
  const speakers = [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "nb"))
    .map(({ name, bios, links }) => {
      // Longest bio, ties broken lexicographically so the choice is stable.
      const bio = bios.sort((a, b) => b.length - a.length || a.localeCompare(b))[0] ?? "";
      // The name is the identity, so the slug is too. A collision means two
      // names normalise the same; numbering keeps the URLs distinct.
      const base = slugify(name) || "foredragsholder";
      const n = (slugs.get(base) ?? 0) + 1;
      slugs.set(base, n);
      return {
        id: n === 1 ? base : `${base}-${n}`,
        name,
        bio: paragraphs(bio),
        links: Object.fromEntries(
          Object.entries(links)
            .map(([key, set]) => [key, [...set].sort()[0]])
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      };
    });

  const idByName = new Map(speakers.map((s) => [s.name, s.id]));
  return { speakers, idByName };
}

/**
 * Rooms in a stable, human order. Upstream sends no room list and no ordering,
 * and the naming scheme changes every year - 2025 used Roman numerals - so the
 * only safe rule is a numeric-aware sort of whatever strings turn up.
 */
const byRoom = (a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

const WEEKDAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Oslo", weekday: "long",
});

// -------------------------------------------------------------------- main

const raw = await fetchProgramme();

const dropped = raw.filter((s) => !usable(s));
const sessions = raw.filter(usable).map(normalise);

if (sessions.length < MIN_SESSIONS) {
  throw new Error(`only ${sessions.length} usable sessions — refusing to write`);
}

const { speakers, idByName } = collectSpeakers(sessions);

// Session URLs. The UUID is what makes them unique, but all 36 characters of it
// in every link is a lot of URL for no gain; the first eight are checked for
// collisions and the full id is used if two ever clash.
const shortIds = new Map();
for (const s of sessions) shortIds.set(s.id.slice(0, 8), (shortIds.get(s.id.slice(0, 8)) ?? 0) + 1);

for (const s of sessions) {
  const short = s.id.slice(0, 8);
  s.slug = `${slugify(s.title) || "sesjon"}-${shortIds.get(short) === 1 ? short : s.id}`;
  s.speakerIds = s.speakers.map((p) => idByName.get(p.name.trim())).filter(Boolean);
  delete s.speakers;
}

// Days, derived from the sessions themselves. There is no day list upstream,
// and the workshop day has a different room set from the two conference days.
const days = [...new Set(sessions.map((s) => s.dayId))].sort().map((date) => {
  const mine = sessions.filter((s) => s.dayId === date);
  const rooms = [...new Set(mine.map((s) => s.roomName))].sort(byRoom);
  return {
    id: date,
    date,
    weekday: WEEKDAY.format(new Date(mine[0].startUtc)),
    startUtc: mine.map((s) => s.startUtc).sort()[0],
    endUtc: mine.map((s) => s.endUtc).sort().at(-1),
    rooms: rooms.map((name) => ({ id: slugify(name), name })),
  };
});

for (const s of sessions) s.roomId = slugify(s.roomName);

// The formats actually present, in the order they should read: the long talks
// first, then the short ones, then the workshops. An unknown value sorts last
// under its own raw name rather than being dropped.
const FORMAT_ORDER = ["presentation", "lightning-talk", "workshop"];
const formats = [...new Set(sessions.map((s) => s.format))]
  .sort((a, b) => {
    const ia = FORMAT_ORDER.indexOf(a);
    const ib = FORMAT_ORDER.indexOf(b);
    return (ia < 0 ? FORMAT_ORDER.length : ia) - (ib < 0 ? FORMAT_ORDER.length : ib)
      || a.localeCompare(b);
  })
  .map((id) => ({
    id,
    slug: slugify(id) || "format",
    name: FORMAT_NAME[id] ?? { no: id, en: id },
  }));

const languages = [...new Set(sessions.map((s) => s.language).filter(Boolean))]
  .sort()
  .map((id) => ({ id, name: LANGUAGE_NAME[id] ?? { no: id.toUpperCase(), en: id.toUpperCase() } }));

const program = {
  event: {
    name: "JavaZone 2026",
    timezone: "Europe/Oslo",
    venue: VENUE,
    slug: SLUG,
    site: "https://2026.javazone.no/",
  },
  days,
  formats,
  languages,
  speakers,
  // Chronological, then by room, so the file is stable across runs.
  sessions: sessions
    .map((s) => ({
      id: s.id,
      slug: s.slug,
      title: s.title,
      dayId: s.dayId,
      roomId: s.roomId,
      roomName: s.roomName,
      startUtc: s.startUtc,
      endUtc: s.endUtc,
      durationMin: s.durationMin,
      format: s.format,
      language: s.language,
      keywords: s.keywords,
      audience: s.audience,
      description: s.description,
      prerequisites: s.prerequisites,
      video: s.video,
      speakerIds: s.speakerIds,
    }))
    .sort(
      (a, b) =>
        a.startUtc.localeCompare(b.startUtc) ||
        byRoom(a.roomName, b.roomName) ||
        a.id.localeCompare(b.id),
    ),
};

await mkdir(path.dirname(DATA_FILE), { recursive: true });
await writeFile(DATA_FILE, JSON.stringify(program, null, 2) + "\n");

for (const s of dropped) {
  console.warn(`  ! skipped a session missing required fields: ${JSON.stringify(s).slice(0, 120)}`);
}
console.log(
  `${program.sessions.length} sessions across ${program.days.length} days, ` +
  `${program.speakers.length} speakers, ${program.formats.length} formats` +
  (dropped.length ? `, ${dropped.length} skipped` : ""),
);
