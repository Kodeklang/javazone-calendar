// Derived view models for the templates. program.json is the source of truth;
// everything here is computed from it and must stay free of anything
// time-dependent, so that an unchanged programme builds byte-identical output.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import rum from "./rum.js";

const raw = readFileSync(new URL("./program.json", import.meta.url), "utf8");
const program = JSON.parse(raw);

// Written by scripts/fetch-photos.mjs. Absent on a checkout that has never run
// it, which is not an error: every speaker simply falls back to the monogram.
const photosRaw = (() => {
  try {
    return readFileSync(new URL("./photos.json", import.meta.url), "utf8");
  } catch {
    return '{"speakers":{}}';
  }
})();
const photos = JSON.parse(photosRaw);

const SLOT_MIN = 5; // one grid row
const MS = 60_000;

// 2.05px per minute, the design's "comfortable" density, at both breakpoints:
// unlike the reference app this one does not stretch the grid on narrow
// screens, because the columns there are a fixed 168px and scroll sideways
// rather than being squeezed.
const SLOT_H = 5 * 2.05;

// Card geometry, mirroring style.css. A card's usable text height follows from
// its duration alone, so what fits in it is known at build time -- no calc()
// inside line-clamp (Safari won't take one) and no measuring in the browser.
// Keep these in step with the CSS if the card chrome changes.
//
// Three tiers, because JavaZone runs 10-minute lightning talks next to
// 4-hour workshops: at this density a 10-minute card is 20px tall and a
// 240-minute one is 492px. The largest tier that fits is chosen per card.
const TIERS = [
  // padY: top+bottom padding, gap: margin below the card, meta: the time and
  // language row, speaker: the italic name under the title.
  { name: "normal", padY: 16, gap: 4, meta: 12, metaGap: 5, speaker: 17.2,
    title: { d: 12.5, m: 11.5 }, leading: 1.28 },
  { name: "compact", padY: 6, gap: 4, meta: 10.8, metaGap: 2, speaker: 0,
    title: { d: 11, m: 11 }, leading: 1.25 },
  { name: "tight", padY: 4, gap: 2, meta: 0, metaGap: 0, speaker: 0,
    title: { d: 10, m: 10 }, leading: 1.1 },
];

const BORDER_Y = 2; // 1px top + 1px bottom

/**
 * Work out how a card of this duration lays itself out: which type tier it
 * uses, whether the time/language row and the speaker name fit, and how many
 * title lines are left over at each breakpoint.
 */
function cardLayout(durationMin) {
  const box = (durationMin / SLOT_MIN) * SLOT_H;

  for (const tier of TIERS) {
    const content = box - tier.gap - BORDER_Y - tier.padY - tier.meta - tier.metaGap;
    const lineFor = (bp) => tier.title[bp] * tier.leading;
    // The tier is usable if a single title line fits under its meta row.
    if (content < lineFor("d") && tier !== TIERS.at(-1)) continue;

    // The speaker name is the first thing to go: it is the least of the three.
    const roomFor = (bp, withSpeaker) => content - (withSpeaker ? tier.speaker : 0);
    const speaker =
      tier.speaker > 0 && roomFor("d", true) >= lineFor("d") * 2;

    const fit = (bp) =>
      Math.max(1, Math.floor(roomFor(bp, speaker) / lineFor(bp)));

    return {
      tier: tier.name,
      meta: tier.meta > 0,
      speaker,
      d: fit("d"),
      m: fit("m"),
    };
  }
}

// One colour per session format, taken from the design's track palette. The
// card's left border is drawn in it and the time on the card is set in it.
//
// The design writes the second and third as oklch(86% 0.13 95) and
// oklch(84% 0.13 145); these are their exact sRGB conversions. Spelled as hex
// so they render identically on the older phones that turn up at a conference,
// and so the contrast figures in the README can be checked against the same
// values the browser paints.
const FORMAT_COLOUR = {
  presentation: "#02dfff",
  "lightning-talk": "#ecd065",
  workshop: "#93e195",
};
// `format` is an open enum, so an edition that adds one still renders.
const FALLBACK_COLOUR = "#aecfff";

const WEEKDAY_NO = {
  Monday: ["Mandag", "Man"], Tuesday: ["Tirsdag", "Tir"], Wednesday: ["Onsdag", "Ons"],
  Thursday: ["Torsdag", "Tor"], Friday: ["Fredag", "Fre"],
  Saturday: ["Lørdag", "Lør"], Sunday: ["Søndag", "Søn"],
};

const MONTH_NO = [
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember",
];
const MONTH_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ms = (iso) => Date.parse(iso);
const floorTo = (t, min) => Math.floor(t / (min * MS)) * min * MS;
const ceilTo = (t, min) => Math.ceil(t / (min * MS)) * min * MS;
const colourOf = (format) => FORMAT_COLOUR[format] ?? FALLBACK_COLOUR;

const formatById = new Map(program.formats.map((f) => [f.id, f]));
const languageById = new Map(program.languages.map((l) => [l.id, l]));
const speakersById = new Map(program.speakers.map((s) => [s.id, s]));

/**
 * The speaker's photo, or null for the majority who have none.
 *
 * Root-relative; the templates put it through Eleventy's `url` filter. Sizes
 * come from the manifest so the img can carry width and height and reserve its
 * own space, rather than reflowing the card once it decodes.
 */
function photo(id) {
  const found = photos.speakers[id];
  return found
    ? { url: `/photos/${found.file}`, width: photos.size, height: photos.size }
    : null;
}

/** Up to two initials, for the monogram that stands in for a speaker photo. */
function initials(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  const picked = parts.length > 1 ? [parts[0], parts.at(-1)] : parts;
  return picked.map((p) => [...p][0]?.toUpperCase() ?? "").join("").slice(0, 2);
}

const clock = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit", hour12: false,
});

const days = program.days.map((day, index) => {
  const sessions = program.sessions.filter((s) => s.dayId === day.id);

  const from = floorTo(Math.min(...sessions.map((s) => ms(s.startUtc))), SLOT_MIN);
  const to = ceilTo(Math.max(...sessions.map((s) => ms(s.endUtc))), SLOT_MIN);
  const row = (iso) => (ms(iso) - from) / MS / SLOT_MIN + 2; // row 1 is the header

  const rooms = day.rooms;
  const colOf = new Map(rooms.map((r, i) => [r.id, i + 2])); // column 1 is the time gutter

  // Whole hours only, as the design draws them. At this density a half-hour
  // rule would sit 61px from its neighbour and the grid is busy enough.
  const rules = [];
  for (let t = ceilTo(from, 60); t <= to; t += 60 * MS) {
    rules.push({ row: (t - from) / MS / SLOT_MIN + 2, label: clock.format(new Date(t)) });
  }

  // Only the formats and languages actually running today. Which columns
  // survive a filter is worked out in the browser from the sessions that match
  // it -- with two independent facets there is no per-chip answer to
  // precompute, and reading it off the surviving cards is exact either way.
  const present = (list, pick) => {
    const seen = new Set(sessions.map(pick).filter(Boolean));
    return list.filter((item) => seen.has(item.id));
  };

  const [long, short] = WEEKDAY_NO[day.weekday] ?? [day.weekday, day.weekday.slice(0, 3)];
  const date = new Date(`${day.date}T12:00:00Z`);
  const dayNo = Number(day.date.slice(8, 10));
  const month = Number(day.date.slice(5, 7)) - 1;

  return {
    id: day.id,
    index,
    number: index + 1,
    date: day.date,
    dateLabel: {
      no: `${dayNo}. ${MONTH_NO[month].slice(0, 3)}.`,
      en: `${MONTH_EN[month].slice(0, 3)} ${dayNo}`,
    },
    longLabel: {
      no: `${long} ${dayNo}. ${MONTH_NO[month]}`,
      en: `${day.weekday} ${dayNo} ${MONTH_EN[month]}`,
    },
    weekday: { no: long, en: day.weekday },
    weekdayShort: { no: short, en: day.weekday.slice(0, 3) },
    // Day one is the site's front page: there is no landing page to pick a day
    // from, so arriving at the root lands on the first day's grid.
    url: index === 0 ? "/" : `/dag/${index + 1}/`,
    startUtc: new Date(from).toISOString(),
    slots: (to - from) / MS / SLOT_MIN,
    rooms,
    rules,
    formats: present(program.formats, (s) => s.format).map((f) => ({
      ...f, colour: colourOf(f.id),
    })),
    languages: present(program.languages, (s) => s.language),
    sessions: sessions.map((s) => {
      const speakers = s.speakerIds.map((id) => speakersById.get(id)).filter(Boolean);
      return {
        ...s,
        url: `/program/${s.slug}/`,
        colour: colourOf(s.format),
        layout: cardLayout(s.durationMin),
        // One name on the card; the rest are on the detail page. Two names
        // rarely fit on a line and the design shows a single one.
        speakerLabel: speakers.length > 1
          ? `${speakers[0].name} +${speakers.length - 1}`
          : speakers[0]?.name ?? "",
        col: colOf.get(s.roomId),
        rowStart: row(s.startUtc),
        rowEnd: row(s.endUtc),
      };
    }),
  };
});

const dayById = new Map(days.map((d) => [d.id, d]));

/** Everything the detail page needs, resolved at build time. */
const sessions = program.sessions.map((s) => {
  const day = dayById.get(s.dayId);
  const overlapping = program.sessions
    .filter((o) => o.dayId === s.dayId && o.id !== s.id)
    .filter((o) => ms(o.startUtc) < ms(s.endUtc) && ms(s.startUtc) < ms(o.endUtc))
    .sort((a, b) =>
      a.startUtc.localeCompare(b.startUtc) ||
      a.roomName.localeCompare(b.roomName, "en", { numeric: true }));

  return {
    ...s,
    colour: colourOf(s.format),
    url: `/program/${s.slug}/`,
    // The same session on JavaZone's own site. Their programme is a SPA whose
    // router declares `/program/:id`, and it builds its own links as
    // `/program/${sessionId}` -- so the key is the Sleeping Pill id this
    // payload already carries, not a slug of the title. The trailing slash is
    // what they redirect to; without it every visit costs a 301 first.
    //
    // Built from the pinned event.site rather than a literal, so bumping the
    // edition stays the one-line change in fetch-program.mjs that SLUG is.
    officialUrl: `${program.event.site.replace(/\/$/, "")}/program/${s.id}/`,
    formatName: formatById.get(s.format)?.name ?? { no: s.format, en: s.format },
    languageName: s.language ? languageById.get(s.language)?.name ?? null : null,
    day: {
      number: day.number, url: day.url,
      weekday: day.weekday, dateLabel: day.dateLabel, longLabel: day.longLabel,
    },
    speakers: s.speakerIds
      .map((id) => speakersById.get(id))
      .filter(Boolean)
      .map((p) => ({ ...p, initials: initials(p.name), photo: photo(p.id) })),
    parallel: overlapping.map((o) => ({
      id: o.id, title: o.title, roomName: o.roomName, startUtc: o.startUtc,
      url: `/program/${o.slug}/`, colour: colourOf(o.format),
    })),
  };
});

// The service worker's cache name must change when *any* shipped asset
// changes, not just the programme, or a CSS edit would never reach a client.

/** Every .njk under src, in a fixed order: readdir's is not one. */
function templates(dir) {
  const found = [];
  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...templates(p));
    else if (entry.name.endsWith(".njk")) found.push(p);
  }
  return found;
}

const assetHash = createHash("sha256").update(raw).update(photosRaw);
for (const f of [
  new URL("../css/style.css", import.meta.url),
  new URL("../css/fonts.css", import.meta.url),
  new URL("../js/app.js", import.meta.url),
  new URL("../../node_modules/@datadog/browser-rum-slim/bundle/datadog-rum-slim.js", import.meta.url),
  // Every template, rather than only the two that generate /js/rum.js and
  // /sw.js. The cache now holds every rendered page, so an edit to anything
  // that shapes one has to retire it - otherwise a fix to a detail page would
  // sit unread behind a cache name still claiming to be current.
  ...templates(fileURLToPath(new URL("../", import.meta.url))),
]) {
  assetHash.update(readFileSync(f));
}
assetHash.update(JSON.stringify(rum));

const first = days[0];
const last = days.at(-1);
const dateRange = {
  no: `${Number(first.date.slice(8, 10))}.–${Number(last.date.slice(8, 10))}. ` +
      `${MONTH_NO[Number(last.date.slice(5, 7)) - 1]} ${last.date.slice(0, 4)}`,
  en: `${Number(first.date.slice(8, 10))}–${Number(last.date.slice(8, 10))} ` +
      `${MONTH_EN[Number(last.date.slice(5, 7)) - 1]} ${last.date.slice(0, 4)}`,
};

export default {
  buildId: assetHash.digest("hex").slice(0, 12),
  version: createHash("sha256").update(raw).digest("hex").slice(0, 12),
  event: { ...program.event, dateRange },
  days,
  sessions,
  // Kept as its own name so the templates read the same as the reference app's,
  // where service entries (lunch, breaks) had no detail page. Sleeping Pill
  // publishes no service entries at all, so here every session is a talk.
  talks: sessions,
  formats: program.formats.map((f) => ({ ...f, colour: colourOf(f.id) })),
  languages: program.languages,
};
