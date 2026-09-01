# JavaZone 2026 — programkalender

A standalone, installable programme calendar for
[JavaZone 2026](https://2026.javazone.no/program/)
(NOVA Spektrum, Lillestrøm, 1–3 September). Rooms across, time down, one page
per session.

There is no day picker to get past: the root serves the first day's grid, and
the other days sit at `/dag/2/` and `/dag/3/`, one tap away in the header.

The published site is plain semantic HTML, CSS and vanilla JavaScript. Eleventy
is a build-time tool only — no framework, and no third-party requests at
runtime: the webfonts are served from this origin.

## Running it

```sh
npm install
npm run fetch     # pull the current programme from Sleeping Pill
npm start         # http://localhost:8080
```

`npm run build` writes the site to `_site/`.

## How the data gets here

The programme comes from JavaZone's own schedule backend, the Sleeping Pill API.
One request returns the whole thing:

```
GET https://sleepingpill.javazone.no/public/allSessions/javazone_2026
```

`docs/sleepingpill-api.md` documents that API in full — the endpoints, the
session shape, the time semantics, and the things it does not guarantee.
`scripts/fetch-program.mjs` is the only thing that talks to it, and it normalises
the payload into `src/_data/program.json`:

- **days and rooms are derived**, because upstream publishes neither. Rooms sort
  numerically, so `Room 1`–`Room 8` come before `Workshop A`–`Workshop D`, and
  nothing parses a number out of a room name — the naming scheme changes every
  year (2025 used Roman numerals).
- **times come from the `Zulu` fields.** The `startTime`/`endTime` pair is naive
  local wall-clock with no offset, so a UTC-defaulting parser would silently
  shift every session by two hours. The local field is used for one thing only:
  deciding which calendar day a session belongs to.
- **speakers are collapsed by exact name.** There is no speaker id upstream, so
  that is the only correlator available. Where the same name carries different
  text the longest bio wins and the links are merged, chosen deterministically.
- **abstracts become escaped, linkified paragraphs**; `workshopPrerequisites`
  stays one preformatted block, because it holds numbered steps and shell
  commands whose line breaks carry meaning.
- the conference slug is **pinned**, not discovered. `GET /public/allSessions`
  would reveal `javazone_2027` — but it appears there the day the organisers
  create it, months before it has a programme, and following it would empty this
  calendar while 2026 was still running. Bump `SLUG` by hand, or set `JZ_SLUG`.

The script sorts everything and writes stable JSON, so an unchanged programme
produces a byte-identical file. It refuses to write a suspiciously small result
rather than publishing an empty programme, and skips individual sessions missing
the fields the site cannot render without.

## How it deploys

`.github/workflows/update-and-deploy.yml` runs hourly, on every push to `main`,
and on demand:

1. fetch → `src/_data/program.json`, committed to `main` only if it changed
2. build with Eleventy
3. publish `_site` to the `gh-pages` branch, committed only if it changed

The site is published at <https://javazone.kodeklang.dev>. Its `CNAME` file lives
in `src/root/` rather than being left where GitHub's custom domain setting writes
it, because step 3 replaces the `gh-pages` tree wholesale — a file only GitHub
put there would be gone on the next hourly run.

Upstream sends no `ETag`, no `Last-Modified` and no `Cache-Control`, so a
conditional request is impossible and every run transfers the full 357 kB. The
git diff is the change detector instead. If the bytes are identical there is no
commit, no deploy, and every ETag on `gh-pages` stays valid — so browsers keep
their cached copy until the programme genuinely changes.

**That makes build determinism load-bearing.** Nothing time-dependent may end up
in the output, or an hourly run would produce a diff every hour and defeat the
caching. So the red now-line and the session countdown are both computed in the
browser, and `version.json` carries a content hash rather than a build timestamp.

The running app polls `version.json` (a 304 with no body until something changes)
and offers a reload when the hash differs from the one it was built with. The
service worker makes that reload instant and the site usable offline.

Offline means the whole programme, not just the pages that were visited. The
worker takes all 181 entries — every day grid, all 155 talks, the subset fonts —
because a conference hall is exactly where signal runs out, and a programme that
only holds the pages someone thought to open first is not much of a programme.
The app shell is precached atomically; the rest is warmed a few files at a time
and tolerates individual failures, so one bad response cannot cost the visitor
everything else.

Because the worker serves CSS and JS cache-first, a visitor arriving right after
a deploy would otherwise run the previous bundle for that whole visit — the new
worker only takes over in the background. So the page reloads itself once when a
new worker claims it, and `sw.js` is registered with `updateViaCache: "none"` so
a deploy is noticed on the next visit rather than up to ten minutes later.

## Filtering

The reference this app was ported from filters by **track**. Sleeping Pill
publishes no track, and the design's chip row is labelled "All keywords" — but
`suggestedKeywords` cannot carry a filter: 393 distinct values across 155
sessions, no controlled vocabulary, Norwegian and English duplicates side by
side, and 14 sessions with none at all. Even normalised and thresholded at three
sessions it reaches only 94 of 155, leaving 40% of the programme unfindable.

So the chips filter on the two fields upstream populates on **every** session:

- **format** — Foredrag (100), Lyntale (43), Workshop (12)
- **language** — Engelsk (101), Norsk (54)

Chips inside one group are alternatives; the two groups narrow each other.
"Lyntale + Norsk" means the Norwegian lightning talks. Only the values a day
actually runs get a chip, so the workshop day does not offer Lyntale.

This is a filter, not a de-emphasis: a hidden session leaves the accessibility
tree along with the layout, so `#filter-status` announces what survived —
"Viser Lyntale + Norsk: 15 sesjoner i 1 rom". A leading "Alt" chip clears
everything. (The design dims non-matching cards to 26% opacity instead, which
reads as a disabled control and puts white text far below any usable contrast.)

Which columns survive is worked out **in the browser**, from the sessions that
actually match, rather than precomputed per chip as the reference does. With two
facets that intersect, no per-chip column list could answer for a combination of
them — and reading it off the surviving cards is exact either way.

Columns collapse by being set to `0px` rather than renumbered, so no session has
to be repositioned. Clearing the selection removes the override and the
stylesheet's own `grid-template-columns` takes over again, which is also what a
visitor without JavaScript gets.

This pays off better here than it did at the reference conference: all 43
lightning talks run in one room, so picking Lyntale collapses Wednesday's eight
columns to Room 6 alone and turns the grid into a readable single-track agenda.

The selection persists in `localStorage` under `jz-filters` and spans days. A day
applies only the values it actually runs but keeps the rest stored, so stepping
to a day without them and back does not quietly drop them.

## Contrast

**The design's surface gradient was changed, deliberately.** The source specifies
`#5c9eff → #3b86dd → #1868bd` under near-white text. Measured, that fails WCAG
2.1 AA almost everywhere: 53 of 66 text/background pairs, with body text at
2.5:1, section labels at 1.7:1 and the cyan time on a session card at 1.4:1,
where AA asks 4.5:1. A mock reads fine at one gradient stop; a 1100px-tall grid
does not.

This site is Norwegian public-facing, where WCAG 2.1 AA is a legal requirement
(forskrift om universell utforming av IKT), so the gradient was walked down into
the design's *own* deep blues until the lightest stop cleared 4.8:1 for every
pair on the page — keeping the hue, the direction, the light-on-blue character
and every other token intact:

```
--surface-top:    #153863   (was #5c9eff)
--surface-mid:    #102c4f   (was #3b86dd)
--surface-bottom: #08203e   (was #1868bd)
```

A handful of the faintest labels also moved up (`rgba(230,240,255,.6)` → `.78`),
and muted filter chips went from 26% to 72% opacity — they are still buttons
with labels, and 26% put the cyan one at 2.6:1.

Verified in the browser by compositing every element's real ancestor
backgrounds against the gradient at its own y position: **40 text elements
across the day grid and a detail page, zero failures.** The tightest are the
JAVAZONE wordmark at 3.6:1 (large text, needs 3) and the time on a session card
at 5.4:1.

To go back to the design's exact gradient, change those three tokens — the rest
of the stylesheet is unchanged.

The design's two `oklch()` track colours are spelled as their exact sRGB
conversions (`oklch(86% 0.13 95)` → `#ecd065`, `oklch(84% 0.13 145)` → `#93e195`)
so they render identically on the older phones that turn up at a conference.

## Other deviations from the design

Real data forced four, all deliberate:

- **No lunch or break bands.** The design draws them across the grid; Sleeping
  Pill publishes no service sessions at all, only talks. Nothing was invented to
  fill them.
- **Speakers are monograms, not photos.** The design shows an initials circle
  where the reference app had a portrait. That is not a placeholder here — the
  API carries no photo URL for anyone, so the monogram is the artwork. It also
  means this app ships no image pipeline at all.
- **No room subtitles.** The design's column headers carry a second line
  ("Main Hall", "Rebel · 2nd floor"); the payload has only the room name.
- **Three card tiers instead of one.** JavaZone runs 10-minute lightning talks
  next to 4-hour workshops, so at the design's 2.05px per minute a card is
  anywhere from 20px to 492px tall. The design's rule (three title lines above
  70px, one below) overflows a 45-minute card and cannot seat a 10-minute one at
  all. `cardLayout()` in `src/_data/site.js` instead picks the largest of three
  type tiers that genuinely fits, then computes how many title lines are left —
  so a 10-minute card shows its title alone, a 20-minute one gains the time and
  language row, and a 45-minute one adds the speaker.

Two sections were **added**, because the data supports them and the reference
had nothing to put there: "Passer for" (`intendedAudience`, present on all 155
sessions) and "Forberedelser" (`workshopPrerequisites`, on 11). A "Opptak" link
appears on its own once `video` is backfilled after the conference.

Day windows come from the data rather than the design's assumed 08:45–16:15.

## Real User Monitoring

`src/_data/rum.js` carries the Datadog application id and client token. Both are
public by design — browser RUM tokens are write-only intake credentials meant to
be shipped to every visitor, and grant no read access to the organisation.

`env` is `prod` only under CI, because GitHub Actions is the only thing that
publishes; a developer running `eleventy --serve` reports as `dev` and never
lands in production data. That value is folded into the asset hash, so a local
build and a CI build of identical source produce different build ids by design.

The SDK is 143KB on a page whose own script is 10KB, so it is loaded on idle
rather than blocking the document — see `src/rum.njk`.

## One-off tooling

Neither of these runs in CI; their output is committed.

```sh
node scripts/fetch-fonts.mjs   # re-vendor Montserrat
python3 scripts/make-icons.py  # redraw the app icon
```

Only Montserrat is vendored. The design sets everything clock-like in the system
monospace, which costs nothing to download. The six faces are subset at build
time to the characters the programme and templates can actually produce, taking
them from 624KB to 220KB — derived rather than hand-written, because a speaker
called Przybył must not silently fall back to a system font.

## Diagnostics

`/debug/` reports what the service worker is doing — which cache is live, what
it holds, which build each cached page is from — for when a phone is stuck on an
old build and nothing visible explains why. It shares no assets with the app, so
a stale `app.js` or `style.css` cannot hide the problem, and it is not precached.
