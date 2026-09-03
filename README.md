# JavaZone 2026 — programkalender

A standalone, installable programme calendar for
[JavaZone 2026](https://2026.javazone.no/program/)
(NOVA Spektrum, Lillestrøm, 1–3 September). Rooms across, time down, one page
per session.

There is no day picker to get past: the root serves the first day's grid, and
the other days sit at `/dag/2/` and `/dag/3/`, one tap away in the header.

The published site is plain semantic HTML, CSS and vanilla JavaScript. Eleventy
is a build-time tool only — no framework, and almost no third-party requests
at runtime: the webfonts and the speaker photos are served from this origin,
and the one exception is the Vimeo player embedded on a recorded session's
page.

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
| LinkedIn | 141 | The photo is in the profile's `og:image`, the link-preview tag this site fills with its own [share cards](#share-cards), but roughly half of all requests answer HTTP 999, some of the rest carry the grey default silhouette, and `/in/` is disallowed in their `robots.txt`. Unusable — and it is the one most speakers have. |
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
change to the circle belongs in both rules — and now in a third place, since the
[share cards](#share-cards) draw the same circle at the same 60px, from the same
files, and a card that treated the two differently would undo the rule on the
surface more people see. The one thing the card does not copy is the monogram's
fill: the stylesheet tints that disc *down* from a light panel, which is
invisible against the card's own dark ground, so the card steps the same
distance the other way. Geometry, ring and crop are the stylesheet's. The card
scales its own copy of the photo down through libvips rather than up: 120px is
all there will ever be, and an avatar enlarged past what it has pixels for would
sit next to crisp type and look worse than the monogram beside it.

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

1. fetch the programme → `src/_data/program.json`
2. fetch the speaker photos → `src/photos/`
3. render the per-session share cards → `src/cards/`
4. commit all three to `main`, in one commit, only if something changed
5. build with Eleventy
6. publish `_site` to the `gh-pages` branch, committed only if it changed

Steps 2 and 3 run every time rather than only behind a programme change, because
an avatar can move under a programme that has not and a card's design can move
under both. Neither is expensive to ask: each is keyed on a hash of what it
draws from, so an unchanged input is recognised and left alone, and an hourly
run over a quiet programme writes nothing at all.

The site is published at <https://javazone.kodeklang.dev>. Its `CNAME` file lives
in `src/root/` rather than being left where GitHub's custom domain setting writes
it, because step 6 replaces the `gh-pages` tree wholesale — a file only GitHub
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
worker takes all 234 entries — every day grid, all 155 talks, the subset fonts,
the speaker photos — because a conference hall is exactly where signal runs out,
and a programme that only holds the pages someone thought to open first is not
much of a programme. The share cards below are the one deliberate exclusion.
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

## Share cards

A link to this site pasted into Slack, LinkedIn, iMessage or Discord unfurls
into a card rather than a bare URL. `src/_includes/base.njk` carries the `og:*`
and `twitter:card` block that asks for that, and every one of the 155 sessions
has a 1200×630 picture of its own to put in it — its title, its speakers, and
the day, time and room, set over the app's own gradient under JavaZone's
wordmark.

```sh
npm run og       # the site-wide card, src/icons/og.png
npm run cards    # one per session, into src/cards/
```

**Those pictures are committed art, and the Eleventy build must never draw
them.** Setting type through librsvg resolves fonts against the host's
fontconfig, so the same SVG rasterises differently on a laptop and on a runner.
By the argument above, a build that drew its own images would therefore produce
a diff on every hourly run and retire every `ETag` on `gh-pages` for a picture
nobody changed. So the generators run outside the build, git carries what they
write, and Eleventy copies it through untouched.

That only holds if a run over an unchanged programme rewrites nothing, which is
what `src/_data/cards.json` is for. It records a hash of each card's finished
SVG together with the raster settings it was encoded under, and a card whose
hash has not moved is left exactly as it was. Hashing the finished SVG rather
than the fields it was drawn from covers strictly more — the font size and the
line breaks the fitter chose for one particular title are in it too — so a
change to the design regenerates the whole set on its own, with nothing to
remember to bump. It is the same reason every encoder setting lives in one
`RASTER` object that the hash covers whole rather than at the call sites: a
knob outside the hash could quietly change all 155 files while the manifest
went on calling them current.

Because a quiet run costs nothing, the workflow can afford to render the
session cards on every hourly pass and let the git diff decide. `npm run og`
stays a hand-run job: the site-wide card says only what the conference is
called and when it runs, so nothing in the programme moves it. It is also the
fallback — the day grids unfurl with it, and so does any session whose own card
has not been drawn, which is the normal state of a checkout that has never run
the generator and no more an error than a speaker without a photo.

**The speakers are on the card, with their faces.** The name is the third thing
a reader looks at, after the title and before the time, and it is the fact the
card used to leave to `og:description` — which iMessage, the client this site is
most often shared into, does not render at all. So a talk shared there came back
with a title and nothing else, and the person giving it was invisible on the one
surface most people ever see. Each speaker is now drawn as a circle with their
name beside it: their photo where there is one, their initials where there is
not, in the same circle at the same size in the same place, which is the rule
[the detail page](#speaker-photos) already follows and for the same reason. Two
long Norwegian names will not fit across a card beside two circles, so the row
steps its type down once and then, if that is still not enough, drops the
circles and keeps the names — four sessions take the smaller step and four set
their names alone. Nothing is ever shrunk to a size it cannot be read at.

That line had to come out of the title's own space: the band the fitter works in
is 282px where it was 306, and the ladder it walks now ends at 46px rather than
52. Only one title in the 2026 programme is long enough to notice — 151
characters, five lines at 52px — and it is set at 46 in four lines rather than
cut off with an ellipsis. Every other card is set at exactly the size it was.

One consequence worth stating: because the photos are embedded in the SVG the
hash is taken over, **a speaker changing their Bluesky avatar now redraws every
card they are on**, in the same hourly bot commit that refetches the photo. That
is the intended behaviour — the card carries their face, so a card that ignored
a new one would be showing the old one — but it means avatar churn is a source
of card diffs where it used to be a source of photo diffs only.

**The cards are deliberately absent from the service worker's precache.** There
are 155 files and 5.2 MB of them, and the only things that ever fetch one are the
crawlers behind Slack, LinkedIn and iMessage — no visitor sees one, on a page or
anywhere else. Precaching them would spend a conference hall's wifi on pictures
nobody in the hall will look at. Ordinary `ETag` caching is the whole story for
a crawler, which is why the filenames carry no hash and no query string: there
is no cache here that has to be busted through the URL.

**`og:title` on a session page carries the abstract, not the session title.**
The picture beside it already shows the title, the day, the time and the room,
and most unfurlers render only the title line — so a title in that slot would be
the picture said twice, in the one place left to say something new.
`og:description` then picks the same sentence up from exactly where the title's
cut fell rather than starting over, so the two never overlap: `splitAbstract` in
`src/_data/site.js` makes both out of one string and one word boundary. The
description opens with the day, the time, the room and the speaker before that
continuation, because a reader whose client renders no picture, or has not
fetched it yet, would otherwise have to open the link to learn when the talk
is.

Open Graph is also the one part of this site that needs **absolute** URLs:
`og:url` and `og:image` are read by a crawler that has no page of ours to
resolve a relative path against. So `src/_data/site.js` carries the origin as
`SITE_URL`, and an `absUrl` filter composes it with Eleventy's own `url` filter
rather than instead of it, so a `PATH_PREFIX` build cannot lose its prefix on
the way out. That origin is what gives every page its `<link rel="canonical">`
too — the github.io mirror builds the same pages, and without one a crawler
sees two URLs for identical content and has to guess which to rank.

Set the two together or neither: `PATH_PREFIX` on its own folds the prefix into
every absolute URL while `SITE_URL` still names the custom domain, which serves
the site from its root, so `og:url`, `og:image` and `canonical` all come out
pointing at `https://javazone.kodeklang.dev/javazone-calendar/…` and 404. CI
sets neither, so this only ever bites a developer building the mirror by hand —
`PATH_PREFIX=/javazone-calendar/ SITE_URL=https://<user>.github.io npm run
build` is the pair that works.

**A repeated `og:image` is not a format negotiation, and each card is now
offered exactly once.** Every card used to be published twice, as a PNG and as
a lossless WebP, listed in that order on the reading that a consumer picks the
format it prefers out of the list and that most take the first one they see. It
was the only mechanism Open Graph offers, there was no content negotiation to
lean on — GitHub Pages serves static files and does not vary on `Accept` — and
`<picture>` had nothing to attach to, because no element on any page ever
renders a card. So the list looked like the answer.

It is not. A session link pasted into iMessage unfurled with **the same card
rendered twice**, one above the other, before the description and the domain:
iMessage walks the list and draws every entry in it. So `base.njk` emits one
`og:image`, the PNG, which decodes everywhere — and the WebP encoder went with
it, because once no tag could reference those 155 files they were 3.6 MB of
`gh-pages` nothing would ever fetch, which is the same defect as publishing a
vendored logo nothing links to. Anyone who has this idea again should read this
paragraph first: the list is a list, not a menu.

The PNG is palette-quantised, which normally ruins a large gradient — but this
ground steps through only 54 levels from top to bottom, so 256 entries hold it
exactly: every pixel of open ground comes back bit-identical, and the 1–2% that
move are antialiasing along glyph edges, by at most 29 of 255. That halves the
set and nothing visible pays for it, and it is independent of everything above —
dropping the WebP left all 155 PNGs byte-for-byte identical.

**Duke is the app icon; the wordmark is what goes on the share cards.** Both are
JavaZone's own, used with the organisers' permission, and they are two halves of
one logo doing jobs the other cannot. A mascot is still recognisable as 16
pixels in a tab strip, where a wordmark is a grey smear; a wordmark names whose
conference this is on a card 1200 pixels wide, where the mascot alone would not.
They live as two files — `src/logos/javazone-duke.png` and
`src/logos/javazone-wordmark.png` — and are not interchangeable.

`src/logos/` exists so that neither is published. It is input to the two
generators and nothing else: no page, tag or manifest links to either file, and
they sat in `src/icons/` — a directory Eleventy passthrough-copies wholesale —
until that meant 186 kB of JavaZone's trademarked marks being served from a
domain that is not theirs, to nobody. `src/css/fonts` is kept out of what is
copied for the same reason, and this is the same arrangement: build inputs live
under `src/`, but only in a directory nothing copies.

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

A third facet, **mine**, joins these two — see below. It is not a field upstream
publishes, but it narrows the other two exactly as they narrow each other.

## Your sessions

A check mark beside the title on a session page marks it as one to see. On the
grid those sessions carry a tick, and a **"Dine sesjoner"** chip filters down to
them — greying the rest out, like every other chip.

The marks live in `localStorage` under **`jz-picks`**, a key of their own rather
than a corner of `jz-filters`. The two are different kinds of thing: a filter is
a throwaway view state that "Alt" is meant to wipe, and the list is something
someone would be annoyed to lose. Sharing a key would have let the one clear the
other.

`localStorage` rather than a cache or IndexedDB, on three counts:

- it is **origin-scoped**, so the installed PWA and a browser tab are reading and
  writing the same list rather than two that drift apart;
- it **outlives every service worker activation** — the worker owns only the
  `jz-<build>` cache, which a deploy retires wholesale, and storage is not in it,
  so an update never costs anyone their marks;
- it is **synchronous**, so the list is in hand before the first paint and a
  marked card is never drawn unmarked and corrected a frame later.

**None of it is baked into the HTML.** Every page is precached and byte-identical
for everyone who loads it, so the marks go on at runtime in `app.js`, the way the
language already does. That is also why the "mine" facet's match test asks the
list rather than a `data-` attribute: no build can know who marked what.

The check is drawn in the **accent**, which in this app is the "this one, out of
all of them" colour — the current day, the pick button, the tick on a card. That
the presentation format shares that cyan is a coincidence of the palette, not a
link; the check mark and the label are what tell the two chips apart, and no
other chip in the row carries an icon. The wordmark's pink was the obvious way
to sidestep the coincidence, and it fails AA where the chip row sits: 3.6:1
against the gradient's top stop, against the 4.5:1 the rest of this app holds
to. The accent clears it at 7.3:1.

**Pressing the chip with nothing marked dims the whole day.** That is the honest
answer to an empty list rather than a special case pretending otherwise, and
"Alt" is one tap from it.

Two things keep a page from showing a stale list. Going back from a session page
is `history.back()`, which can restore the grid from the bfcache exactly as it
was left — before the mark that was just made — so `pageshow` re-reads storage
when `persisted` is set. And two tabs open on the same programme are one list
seen twice, so the `storage` event re-reads it in the tab that did not write.

On the grid the tick rides at the end of the card's meta row, whose height is
already part of the build-time card geometry in `_data/site.js`, so it costs no
line and no card grows. The 10-minute tier has no meta row at all — those cards
are 20px tall and hold their title and nothing else — so they show no tick. That
row is `aria-hidden`, so the tick alone would say nothing; `.session__mark`
inside the card's hidden text carries the same fact in the current language.

## Recordings

**A card carrying a small TV glyph has a recording.** That is a fact about the
programme rather than about anyone's own list, which is why it takes a neutral
ink and not the accent — the accent in this app means "this one, out of all of
them", and it belongs to the marks a reader made. It is also why, on a card that
has both, the TV sits to the *left* of the tick: the outermost corner stays the
tick's, because the tick is the one mark on the grid that came from the reader.

`session.video` is a bare Vimeo id, and Sleeping Pill backfills it only after the
conference — until then no card carries the glyph at all, the same way the
Vimeo link in the header's linkrow and the player in the "Opptak" section below
it both stay absent until there is something to link to. Today 22 of the 155
sessions have one, all of them on the second day. Because `.session__meta` is
`aria-hidden` the glyph alone would say nothing, so the card's hidden text
carries "Opptak" / "Recording" beside the room and the time, in the same words
the session page uses for the same thing.

**The Vimeo link moved into the header; the "Opptak" section now holds the
player.** It used to be the section's only content, a bare anchor under the
heading; now it sits in the linkrow beside "Se på javazone.no" and "Kopier
lenke", in the same nested-span-plus-arrow shape as the javazone.no link
beside it, so a reader with somewhere to go finds it with the other two
rather than at the foot of the page. What fills the section now is Vimeo's
own `<iframe>`, sized by `aspect-ratio: 16 / 9` on the frame itself instead
of the padding-top wrapper Vimeo's own snippet asks for, and without the
snippet's `player.js`
— nothing on this page drives the Player API, so the script would be dead
weight.

**That embed is the one hole in "works in a hall with no signal at all."**
The service worker correctly leaves cross-origin requests alone, so nothing
throws - but with no signal the iframe never loads, and a recorded session's
"Opptak" heading now sits over a blank 288×162 box where readable link text
used to be. Moving the link into the header softens that rather than closing
it: offline, a reader still finds "Se opptaket på Vimeo" at the top of the
page, just nothing below it explaining why the box under the heading is
empty.

**Drawn as an SVG (`src/_includes/tv.njk`), not the 📺 emoji.** The emoji is a
colour raster glyph: it renders as a different picture on every platform, it
ignores `currentColor`, so it could not step back with everything else on a
greyed-out card, and at these sizes it would read as a badge stuck to the card
rather than as a mark on it. The TV is drawn the way `check.njk` draws the check,
in the same 16×16 box and off the same `currentColor` stroke, so the two marks on
a card belong to one family.

**The 10-minute tier does show the marker, where it shows no tick.** The tick can
ride in the meta row for nothing and simply goes missing on cards that have no
meta row; a recording is not the reader's own doing and is worth flagging
wherever it exists, so on the tight tier the glyph becomes an absolutely
positioned corner overlay (`.session__tv--corner`) with the title padded to clip
before it reaches it. That costs a few characters of title on the handful of
10-minute cards that have a recording, which is the cheaper of the two losses.

Where it does ride in the meta row its box is deliberately smaller than the row:
11px on the normal tier and 10px on the compact one, under the `meta: 12` and
`meta: 10.8` those tiers declare in `_data/site.js`. The row is a flex row and
takes the height of its tallest child, so a glyph a pixel taller than the
declared figure would quietly grow the row that every title's line count is
divided out of. A compact-tier glyph left at 11px did exactly that, and it showed
up in measured cards rather than in the CSS.

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
sessions) and "Forberedelser" (`workshopPrerequisites`, on 11). The "Opptak"
section holds an embedded player once `video` is backfilled after the
conference, with a matching link in the header alongside it.

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

None of these runs in CI; their output is committed.

```sh
node scripts/fetch-fonts.mjs   # re-vendor Montserrat
npm run icons                  # redraw the app icon and the favicon
npm run og                     # redraw the site-wide share card
```

The generator missing from that list is `npm run cards`, and it is missing
because it is the only one the programme moves under: run it by hand like these,
and CI runs it hourly beside the photo fetch. See [Share cards](#share-cards).

The icon is JavaZone's own Duke, used with the organisers' permission, over the
blue the app has always used. He is vendored as `src/logos/javazone-duke.png`
rather than fetched, because upstream serves him under a content-hashed filename
that changes on every deploy of theirs. The favicon is drawn from a much tighter
crop than the launcher icon — at 16px the whole mascot is a smudge, and only the
hat and the red nose survive.

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
