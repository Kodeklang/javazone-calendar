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

// Written by scripts/build-session-cards.mjs, and absent for the same reason
// and to the same effect: a session with no card of its own unfurls with the
// site-wide src/icons/og.png instead, which is what the day grids use anyway.
const cardsRaw = (() => {
  try {
    return readFileSync(new URL("./cards.json", import.meta.url), "utf8");
  } catch {
    return '{"cards":{}}';
  }
})();
const cards = JSON.parse(cardsRaw);

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

/**
 * The session's own share card, or null if it has none yet.
 *
 * Root-relative, like `photo` above, and left for the templates to put
 * through Eleventy's `url` filter and then `absUrl` - og:image is ignored by
 * every unfurler unless it is absolute.
 */
function shareCard(id) {
  const found = cards.cards[id];
  // Both formats or neither. base.njk offers a crawler the PNG and the WebP as
  // alternates of one image, so a manifest entry naming only one of them - an
  // older cards.json, a half-applied merge - has to fall back to the site-wide
  // card in both formats rather than advertise a `/cards/undefined.webp`.
  return found?.file && found?.webp
    ? {
        url: `/cards/${found.file}`,
        webp: `/cards/${found.webp}`,
        width: cards.width,
        height: cards.height,
      }
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

// Named entities scripts/fetch-program.mjs's escapeHtml can produce, plus the
// ones upstream Sleeping Pill text already contains. `&amp;` is decoded last,
// or an upstream `&amp;quot;` would collapse straight to `"` instead of the
// `&quot;` it is meant to spell.
const NAMED_ENTITIES = {
  "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Decode the HTML entities in text pulled out of markup, so that when a
 * template hands it to Nunjucks it is escaped exactly once rather than
 * carrying entity text that Nunjucks then escapes a second time.
 */
function decodeEntities(s) {
  let out = s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
  for (const [entity, char] of Object.entries(NAMED_ENTITIES)) out = out.split(entity).join(char);
  return out.split("&amp;").join("&");
}

/**
 * A session description paragraph is already-escaped, linkified HTML (see
 * `paragraphs` in fetch-program.mjs). Metadata fields want plain prose
 * instead, so the tags are dropped and what they leave behind - entity text,
 * since stripping a tag does not undo the escaping inside it - is decoded.
 */
function plainText(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ""));
}

/**
 * The abstract as one run of prose, every paragraph joined rather than just
 * `description[0]`: Sleeping Pill sometimes opens an abstract with a
 * subtitle fragment in a paragraph of its own - an em dash and a few words -
 * with the sentence that actually says something starting in the next one.
 * Reading only the first paragraph can hand og:title a fragment that trails
 * off and never lands. A `<br>` is a soft break inside one paragraph rather
 * than a paragraph boundary, so it is turned into a space rather than
 * dropped - `plainText` alone would delete it and glue the words either side
 * of it together, which matters once several paragraphs are run together
 * into one string. The leading dash such a fragment opens with is stripped
 * last, since it reads as a broken sentence at the head of a headline, not
 * as a title's own opening.
 */
function abstractText(s) {
  if (!s.description.length) return "";
  const joined = s.description.join(" ").replace(/<br\s*\/?>/gi, " ");
  return plainText(joined).replace(/^[-–—]\s*/, "");
}

// The budget counts code points, not UTF-16 code units, and the ellipsis
// itself counts toward it, added only when something was actually cut - a
// description that already fits must not gain one it doesn't need.
const META_DESCRIPTION_MAX = 160;

// og:title's budget: iMessage and LinkedIn give the headline about two
// lines, and a longer string is cut by the platform itself, in a place this
// build does not control.
const SHARE_TITLE_MAX = 110;

/**
 * The code-point index within `chars` where a cut at `max` characters
 * should land: the last space before the limit, so neither a truncation nor
 * a continuation of the same text ever splits a word. Falls back to the
 * limit itself when no space exists to fall back to. Shared by `truncate`
 * and `splitAbstract` below so the two never disagree about where a given
 * cut actually falls.
 */
function wordBoundary(chars, max) {
  if (chars.length <= max) return chars.length;
  const window = chars.slice(0, max - 1);
  const lastSpace = window.lastIndexOf(" ");
  return lastSpace > 0 ? lastSpace : window.length;
}

/**
 * The ellipsis that says a cut happened, put on the end of what the cut left
 * behind - and put there on its own. A cut lands wherever `wordBoundary`
 * found a space, which every so often is the space after the end of a
 * sentence, and appending to that unexamined spells `.…` or `?…`. The two
 * marks are then claiming the same thing about the same place and only one
 * of them is true: the sentence did not end there, the text ran out. So the
 * trailing whitespace and punctuation go and the ellipsis stays - the same
 * debris, at the same seam, that `splitAbstract` strips off the front of the
 * continuation.
 *
 * Every character this can strip is in the BMP, so it cannot undo
 * `truncate`'s care over surrogate pairs by taking half of one.
 */
function withEllipsis(text) {
  return `${text.replace(/[\s.,;:!?…]+$/, "")}…`;
}

/**
 * Cut plain text at a word boundary so a truncated description never ends
 * mid-word. Spreading into an array first splits on code points rather than
 * UTF-16 code units, so a cut can never land inside a surrogate pair - an
 * emoji, or an astral character `decodeEntities` produced via
 * `String.fromCodePoint` from a numeric entity - and leave a lone surrogate
 * (invalid UTF-16) in the output.
 */
function truncate(text, max) {
  const chars = [...text];
  const end = wordBoundary(chars, max);
  if (end === chars.length) return text;
  return withEllipsis(chars.slice(0, end).join(""));
}

/**
 * Split one abstract across og:title and og:description without either
 * repeating the other. `head` is exactly what `truncate` would produce - the
 * opening, cut at the same word boundary via the same `wordBoundary`, with
 * an ellipsis only when something was actually cut. `rest` is everything
 * after that boundary, so og:description can pick the sentence up where
 * og:title left off rather than start over from the beginning. It comes
 * back stripped of the word break itself and of any punctuation the cut
 * left dangling (a trailing comma, colon or dash before the next clause) so
 * the continuation opens on a fresh word, never on debris from the seam -
 * and it comes back empty when `head` already is the whole abstract, which
 * is `shareDescription`'s signal that there is nothing left to continue.
 */
function splitAbstract(text, max) {
  const chars = [...text];
  const end = wordBoundary(chars, max);
  if (end === chars.length) return { head: text, rest: "" };
  const head = withEllipsis(chars.slice(0, end).join(""));
  let start = end;
  while (start < chars.length && /[\s,;:.!?…\-–—]/.test(chars[start])) start++;
  return { head, rest: chars.slice(start).join("") };
}

/**
 * The three facts a share card needs before any prose: day, start time and
 * room. The room is spelled out because, unlike the grid card, a share card
 * has no column to place it in, and the time comes from the same Oslo clock
 * the grid is drawn against so a card cannot disagree with the page it links
 * to about when a talk starts.
 *
 * Kept apart rather than pre-joined because the two things that want them
 * space them differently: og:description runs them into one line, and
 * scripts/build-session-cards.mjs sets the time in the session's own format
 * colour, which needs it as a piece of its own.
 */
function shareFacts(s, day) {
  return {
    day: day.longLabel.no,
    time: clock.format(new Date(s.startUtc)),
    room: s.roomName,
  };
}

/**
 * The same three, as og:description leads with them, plus a speaker if there
 * is one in the grid card's own shorthand for a name. A speakerless session
 * must not leave a dangling " · " where the name would otherwise go.
 */
function factsLine(s, day, speakers) {
  const { day: dayLabel, time, room } = shareFacts(s, day);
  const speaker = speakers.length
    ? ` · ${speakers.length > 1 ? `${speakers[0].name} +${speakers.length - 1}` : speakers[0].name}`
    : "";
  return `${dayLabel} ${time} · ${room}${speaker}`;
}

/**
 * og:description for a session: the facts above, then the abstract picking
 * up exactly where og:title stopped.
 *
 * The card the description sits next to already carries the title, the day,
 * the time and the room, so the title and description slots are the only
 * two places left to say something the reader doesn't already have - and
 * Slack and Discord render both at once, so spending either on a repeat of
 * the other wastes it rather than adding to it. One abstract is therefore
 * split, never duplicated: `titleSplit.rest` is everything og:title's own
 * cut left off (see `splitAbstract`), so the description continues the same
 * sentence instead of restating its opening. When there is nothing left to
 * continue - the abstract was short enough that og:title already carries
 * all of it, or there is no abstract at all - the description falls back to
 * the facts alone, which is still new information and repeats nothing.
 */
function shareDescription(s, day, speakers, titleSplit) {
  const facts = factsLine(s, day, speakers);
  if (!titleSplit || !titleSplit.rest) return facts;
  const joiner = " — ";
  const budget = META_DESCRIPTION_MAX - facts.length - joiner.length;
  if (budget < 20) return facts;
  return `${facts}${joiner}${truncate(titleSplit.rest, budget)}`;
}

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
  const speakers = s.speakerIds
    .map((id) => speakersById.get(id))
    .filter(Boolean)
    .map((p) => ({ ...p, initials: initials(p.name), photo: photo(p.id) }));
  // The one abstract og:title and og:description split between them - see
  // `splitAbstract`. Computed once, from the joined `abstractText`, and
  // shared below: shareDescription reads its continuation off `titleSplit`
  // rather than re-deriving where og:title cut, so the two can never
  // disagree about the seam between them.
  const abstract = abstractText(s);
  const titleSplit = abstract ? splitAbstract(abstract, SHARE_TITLE_MAX) : null;

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
    // For <meta name="description">: plain prose, not the linkified HTML the
    // page body renders, and short enough that Nunjucks' single escape pass
    // never trips a viewer's 160-character line in search results or a share
    // card. Falls back to the title for the handful of sessions Sleeping Pill
    // publishes with no abstract at all.
    metaDescription: s.description.length
      ? truncate(plainText(s.description[0]), META_DESCRIPTION_MAX)
      : s.title,
    // For og:title: the session's card already shows its title, day, time
    // and room, and an unfurler that renders only the title line (iMessage,
    // LinkedIn, X) would otherwise just repeat the picture, so the share
    // title carries the abstract's opening instead - all of it run together
    // (see `abstractText`), not just the first paragraph, since Sleeping
    // Pill sometimes opens with a subtitle fragment that says nothing on its
    // own. A session with no abstract falls back to its own title, same as
    // `metaDescription` does.
    shareTitle: titleSplit ? titleSplit.head : s.title,
    // For og:description, which unlike <meta name="description"> above leads
    // with the facts a share card is actually for, then continues og:title's
    // abstract rather than repeating it - see `shareDescription`.
    shareDescription: shareDescription(s, day, speakers, titleSplit),
    // The same facts unjoined, for the two places that set them as type
    // rather than as prose: the session's own share card, and the alt text
    // describing it.
    shareFacts: shareFacts(s, day),
    shareCard: shareCard(s.id),
    formatName: formatById.get(s.format)?.name ?? { no: s.format, en: s.format },
    languageName: s.language ? languageById.get(s.language)?.name ?? null : null,
    day: {
      number: day.number, url: day.url,
      weekday: day.weekday, dateLabel: day.dateLabel, longLabel: day.longLabel,
    },
    speakers,
    parallel: overlapping.map((o) => ({
      id: o.id, title: o.title, roomName: o.roomName, startUtc: o.startUtc,
      url: `/program/${o.slug}/`, colour: colourOf(o.format),
    })),
  };
});

// The service worker's cache name must change when *any* shipped asset
// changes, not just the programme, or a CSS edit would never reach a client.

/**
 * Every .njk under src, plus its .11tydata.js siblings (program.11tydata.js,
 * dag.11tydata.js), in a fixed order: readdir's is not one. The data files
 * shape a page's `<title>` and description just as much as the template
 * markup does, so they have to retire the cache the same way an edit to the
 * .njk itself would.
 */
function templates(dir) {
  const found = [];
  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...templates(p));
    else if (entry.name.endsWith(".njk") || entry.name.endsWith(".11tydata.js")) found.push(p);
  }
  return found;
}

// cards.json is deliberately not in here, unlike photos.json. Redrawing the
// share cards changes no page a visitor can see - the og:image URL is built
// from the session's slug, so only the pixels behind it move, and those are
// fetched by crawlers and never by the worker. Folding them in would retire
// every client's cache and re-download the whole programme over a change
// nobody in the hall can observe. A card appearing or disappearing does change
// a page, but that only happens when a session joins or leaves the programme,
// which `raw` already covers.
const assetHash = createHash("sha256").update(raw).update(photosRaw);
for (const f of [
  // This file, for the same reason the .11tydata.js siblings below are in the
  // list: every page's `<title>`, description, og:title and og:description are
  // computed here, so a change to a truncation budget or to how an abstract is
  // turned into prose rewrites the markup of every page. Left out, an edit
  // here would ship pages the worker's cache name still calls current, which is
  // exactly the staleness the cache name exists to prevent.
  new URL("./site.js", import.meta.url),
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

// The origin og:url and og:image compose against. Overridable so a preview
// deploy can carry its own origin, but the deploy workflow itself sets
// nothing, so CI always builds against the production domain in CNAME - the
// build stays deterministic either way. Stripped of any trailing slash so
// the `absUrl` filter, which appends a leading-slash path, never produces
// `//` at the join.
const SITE_URL = (process.env.SITE_URL ?? "https://javazone.kodeklang.dev").replace(/\/+$/, "");

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
  url: SITE_URL,
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
