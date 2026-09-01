# JavaZone 2026 — programkalender

A standalone, installable programme calendar for
[JavaZone 2026](https://2026.javazone.no/program/)
(NOVA Spektrum, Lillestrøm, 1–3 September). Rooms across, time down, one page
per session.

There is no day picker to get past: the root serves the first day's grid, and
the other days sit at `/dag/2/` and `/dag/3/`, one tap away in the header.

The published site is plain semantic HTML, CSS and vanilla JavaScript. Eleventy
is a build-time tool only — no framework, and no third-party requests at
runtime: the webfonts and the speaker photos are served from this origin.

## Running it

```sh
npm install
npm run fetch     # pull the current programme from Sleeping Pill
npm run photos    # pull speaker photos from Bluesky
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

## Speaker photos

Sleeping Pill carries no photo URL for anyone, and JavaZone's own site reads the
same API, so the only place a portrait can come from is the speaker's own social
links. Of the three the payload carries, exactly one is reachable:

| Link | Speakers | |
| --- | --- | --- |
| LinkedIn | 141 | The photo is in `og:image` on the public profile, but roughly half of all requests answer HTTP 999, some of the rest carry the grey default silhouette, and `/in/` is disallowed in their `robots.txt`. Unusable — and it is the one most speakers have. |
| Bluesky | 60 | A documented, unauthenticated XRPC API. **This is the source.** |
| Twitter | 54 | No public API since 2023. Only reachable through a third-party avatar proxy, which rate-limits and answers with a generic face rather than a 404 when it finds nothing. |

`npm run photos` resolves each Bluesky handle through `app.bsky.actor.getProfile`,
downsizes the 1000×1000 source to a 120×120 WebP, and writes `src/photos/` plus a
manifest at `src/_data/photos.json`. 120px is exactly 2× the 60px the card draws,
and covers the 46px it draws on narrow screens.

That yields **56 photos for 182 speakers**. A third of the handles are a bare word
rather than a domain — `gsaab`, `jhannes` — which resolves to nothing as written;
appending `.bsky.social` recovers six of them. The rest of the shortfall is real:
two accounts have set no avatar, two do not resolve under any spelling.

So most speakers keep the monogram, permanently. `.speaker__mono` and
`.speaker__photo` are therefore given identical geometry at both breakpoints, so a
list mixing them reads as one treatment rather than a half-finished import. Any
change to the circle belongs in both rules.

Re-running is cheap and safe. A Bluesky avatar URL ends in the blob's CID, so the
URL *is* the content hash: an unchanged avatar is recognised from the manifest and
never re-downloaded or re-encoded, and a run over an unchanged programme writes
nothing at all. Photos for speakers who leave the programme, or who drop their
Bluesky link, are pruned. A speaker whose lookup fails keeps the photo the last
good run found, and if more than half of all lookups fail the script writes
nothing and exits non-zero — an outage must not be mistaken for 56 speakers
deleting their avatars at once.

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
and updates itself silently when the build id differs from the one it was built
with — it asks the service worker to update, and the worker claiming the page
reloads it. The service worker makes that reload instant and the site usable
offline.

`version.json` carries two hashes and the poll compares the **build** one.
`version` covers `program.json` alone, so it says whether the programme moved;
`build` covers everything shipped — templates, CSS, JS, speaker photos — and is
what names the worker's cache. Comparing the programme hash missed layout
changes entirely: adding speaker photos to the detail pages rewrote every page
without touching it, so the pages went stale with nothing to notice.

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

Every request that fills the cache is made with `cache: "reload"`, including the
background revalidation behind a served page. GitHub Pages stamps everything
`max-age=600`, so a plain fetch in the ten minutes after a deploy is answered
from the browser's HTTP cache with pre-deploy bytes — and storing those under a
cache name that asserts they are the new build poisons the entry for good, since
the warm pass skips anything already present.

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

**Selecting a filter greys the rest out; it never removes them.** A session
outside the selection stays exactly where it is, so the grid keeps its shape,
nothing reflows under the reader, and a talk that only just missed the filter is
still there to be noticed. `#filter-status` reports the split —
"Lyntale: 25 av 79 sesjoner markert, resten nedtonet". A leading "Alt" chip
clears everything. Nothing leaves the accessibility tree, because nothing leaves
the page.

Greyed out by **draining the colour, not with `opacity`**. Opacity fades a
card's text and its background toward the page at the same rate, so the contrast
*inside* the card collapses: at 0.8 the time on a card falls to 3.8:1, and the
design's 0.26 puts it at 1.6:1 — unreadable. Setting the dimmed colours
explicitly instead keeps every pair at 5:1 or better, measured in the browser,
while still reading as clearly secondary: the card fill halves in luminance, the
title steps back from white, and the format accent on the left edge goes grey.

Because nothing is removed, no column can be empty, so **columns no longer
collapse**. An earlier version zeroed the width of rooms the selection did not
reach — picking Lyntale turned Wednesday's eight columns into Room 6 alone, a
neat single-track agenda. That is incompatible with keeping non-matching
sessions on screen, and it was the weaker of the two behaviours: it hid the
context that makes a conference grid worth looking at. The trade is deliberate;
restoring it would mean hiding cards again.

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
and an unselected filter chip went from 40% to 72% opacity — it is still a
button with a label, and 40% put the cyan one at 2.6:1.

Verified in the browser by compositing every element's real ancestor
backgrounds against the gradient at its own y position: **40 text elements
across the day grid and a detail page, zero failures**, plus every card in both
the highlighted and greyed-out filter states. The tightest are the JAVAZONE
wordmark at 3.6:1 (large text, needs 3), the time on a live card at 5.4:1, and
the time on a greyed-out card at 5.6:1.

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
- **Most speakers are monograms, not photos.** The design shows an initials
  circle where the reference app had a portrait. Sleeping Pill carries no photo
  URL for anyone, and only 56 of 182 speakers have a portrait that can be
  fetched from anywhere at all (see [Speaker photos](#speaker-photos)). So the
  monogram is not a placeholder waiting to be filled — it is what most cards
  will always show, and the two are drawn to the same circle.
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
