# Sleeping Pill API — JavaZone schedule source

Specification of the upstream data source for `javazone-calendar`.

- **Base URL:** `https://sleepingpill.javazone.no`
- **Server:** Jetty 9.4.30 (`no.java.moresleep` — the "moresleep" application)
- **Auth:** none on the `/public/*` endpoints
- **Verified against:** JavaZone 2026 (155 sessions), 2026-09-01

## 1. How this source was identified

`https://2026.javazone.no/program/` serves an empty SPA shell (`<div id="root">`) and
loads its schedule client-side. The production bundle
`https://2026.javazone.no/assets/index-*.js` contains a single fetch against the
schedule backend:

```js
async function loadSessions() {
  const res = await fetch("https://sleepingpill.javazone.no/public/allSessions/javazone_2026")
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  if (!isSessionsResponse(body)) throw new Error("Unexpected response shape")
  return body.sessions.filter(s => s.title)   // note: the site drops untitled sessions
}
```

This is the only schedule endpoint the site calls. There is no GraphQL layer, no
pagination, and no per-session fetch — the entire programme arrives in one response.

## 2. Endpoints

### 2.1 `GET /public/allSessions` — conference index

Returns every JavaZone edition known to the backend (2006–2026 as of writing).

```json
{
  "conferences": [
    { "id": "95759742-2a8c-4542-9eb0-7c52f598a3da",
      "name": "JavaZone 2026",
      "slug": "javazone_2026" }
  ]
}
```

| Field  | Type   | Notes |
|--------|--------|-------|
| `id`   | string | Conference UUID. Matches `conferenceId` on every session. Pre-2017 and post-2018 editions use dashed UUIDs; 2017 and 2018 use undashed 32-char hex. |
| `name` | string | Display name, `"JavaZone <year>"`. |
| `slug` | string | Path segment for §2.2. Always `javazone_<year>`. |

`GET /data/conference` returns a byte-identical body and appears to be the same
handler under a different route. Prefer `/public/allSessions`; it is the documented-by-usage path.

Use this endpoint for **year discovery** rather than hardcoding a slug — it is how the
client learns that `javazone_2027` exists once the next edition is created.

### 2.2 `GET /public/allSessions/{slug}` — full programme

The single endpoint the calendar needs.

```
GET https://sleepingpill.javazone.no/public/allSessions/javazone_2026
```

```json
{ "sessions": [ { /* Session, see §3 */ } ] }
```

No query parameters are supported — `?anything=x` is accepted and ignored, and the full
set is always returned. Filtering, sorting and searching are the client's job.

Response size for 2026: ~357 kB uncompressed, ~126 kB gzipped. `HEAD` and `OPTIONS`
both return 200.

## 3. Session object

Every field is a **string** — including `length`, which is a number of minutes rendered
as text. There are no nulls; absent data is either an omitted key or an empty string.

Presence counts below are from the 2026 payload (155 sessions).

| Field | Presence | Description |
|-------|----------|-------------|
| `id` | 155/155 | Session UUID. **The stable identifier** — use it for calendar UIDs. |
| `sessionId` | 155/155 | Always byte-identical to `id` in all observed payloads. Redundant; ignore it. |
| `conferenceId` | 155/155 | Conference UUID; constant across the response. |
| `title` | 155/155 | Session title. Never empty in 2026, but the official site defensively filters falsy titles — do the same. |
| `abstract` | 155/155 | Long description. Plain text with `\n` line breaks; **not** HTML, though it may contain Markdown-ish markup and bare URLs. |
| `intendedAudience` | 155/155 | Free-text "who is this for". Never empty in 2026. |
| `suggestedKeywords` | 155/155 | Comma-separated free text, e.g. `"legacy, kodearkeologi, end-of-life"`. **Empty string in 14/155.** Not a controlled vocabulary — casing and spacing are inconsistent. |
| `format` | 155/155 | Enum, see §3.1. |
| `length` | 155/155 | Duration in minutes as a string, see §3.1. |
| `language` | 155/155 | `"en"` (101) or `"no"` (54). ISO 639-1. |
| `room` | 155/155 | Room name, see §3.2. |
| `startTime` | 155/155 | Local wall-clock start, see §4. |
| `endTime` | 155/155 | Local wall-clock end. |
| `startTimeZulu` | 155/155 | UTC start. |
| `endTimeZulu` | 155/155 | UTC end. |
| `startSlot` | 155/155 | Scheduling slot start, local. Equal to `startTime` in every 2025 and 2026 session. |
| `startSlotZulu` | 155/155 | Slot start, UTC. Equal to `startTimeZulu`. |
| `speakers` | 155/155 | Array, see §3.3. Never empty; 1–3 entries. |
| `workshopPrerequisites` | 13/155 | **Key omitted** unless present. Setup instructions for workshops. Long multi-line text, frequently containing Markdown and fenced code blocks. Present on 12 workshops plus one presentation. Values are sometimes placeholders (`"..."`, `"N/A"`). |
| `video` | 0/155 | **Key omitted before the conference.** Appears afterwards — 126/137 sessions in the 2025 payload have it. |

### 3.1 `format` and `length`

`length` is fully determined by `format` in practice, but treat that as coincidence, not contract:

| `format` | Count | `length` values (minutes) |
|----------|-------|---------------------------|
| `presentation` | 100 | `"45"` (72), `"60"` (28) |
| `lightning-talk` | 43 | `"20"` (31), `"10"` (12) |
| `workshop` | 12 | `"120"` (8), `"240"` (4) |

Older editions have used additional format values. Treat `format` as an **open enum**:
match known values, fall back to rendering the raw string rather than dropping the session.

`int(length)` equals `endTime - startTime` in minutes for all 155 sessions in 2026.
Derive duration from the timestamps anyway — they are the authority, and `length` is
a scheduling intent that could drift from a rescheduled session.

### 3.2 `room`

2026 uses `Room 1`–`Room 8` and `Workshop A`–`Workshop D`. Room naming is **not stable
across years**: 2025 used Roman numerals (`Room I`–`Room VII`) and `Workshop A`–`Workshop E`.
Never hardcode room names or parse a number out of them; treat the value as an opaque
display label and group by exact string.

All lightning talks share one room (`Room 6` in 2026, `Room VI` in 2025).

### 3.3 Speaker object

```json
{
  "name": "Elisabeth Irgens",
  "bio": "Elisabeth utvikler programvare i Amedia, ...",
  "linkedin": "https://www.linkedin.com/in/elisabethirg/",
  "bluesky": "@jbaru.ch",
  "twitter": "@jbaruch"
}
```

| Field | Presence (of 184 speaker entries) | Notes |
|-------|-----------------------------------|-------|
| `name` | 184/184 | Display name. |
| `bio` | 184/184 | Free text, `\n` line breaks. |
| `linkedin` | 142/184 | Usually a full `https://www.linkedin.com/in/...` URL. |
| `bluesky` | 60/184 | Handle, **inconsistently** with or without a leading `@` (`@jbaru.ch`, `pettertech`). |
| `twitter` | 54/184 | Handle, same `@` inconsistency. |

There is **no speaker ID and no photo URL**. Speakers can only be correlated across
sessions by exact name match — do not build a speaker index that assumes uniqueness or
stable spelling.

Sessions have 1 speaker (127), 2 (27), or 3 (1).

### 3.4 `video`

Absent until after the conference. When present it is a **bare Vimeo numeric ID as a
string** (`"1115460917"`), not a URL. Construct links yourself:

- watch: `https://vimeo.com/{video}`
- embed: `https://player.vimeo.com/video/{video}`

11 of 137 sessions in 2025 never got a video (workshops and withdrawn talks).

## 4. Time semantics

Each session carries the same instant twice:

```json
"startTime":      "2026-09-03T15:40",
"startTimeZulu":  "2026-09-03T13:40:00Z",
"endTime":        "2026-09-03T16:25",
"endTimeZulu":    "2026-09-03T14:25:00Z"
```

- `*Time` / `*Slot` are **naive local wall-clock** in `Europe/Oslo`, minute precision,
  **no offset and no seconds**. `2026-09-03T15:40` is not a valid instant on its own —
  parsing it with a UTC-defaulting parser silently shifts every session by two hours.
- `*Zulu` are true UTC instants with seconds and a `Z` suffix.
- The offset is `+02:00` (CEST) for all 155 sessions in 2026. JavaZone falls in
  early September, comfortably inside CEST, but the DST transition is late October —
  a hypothetical late edition would mix offsets.

**Use the `Zulu` fields as the source of truth** and convert to `Europe/Oslo` for
display. They are unambiguous, and they are the only fields safe to feed into a
calendar without a timezone database lookup.

### JavaZone 2026 shape

| Date | Sessions | Composition |
|------|----------|-------------|
| 2026-09-01 (Tue) | 12 | Workshops only |
| 2026-09-02 (Wed) | 79 | 54 presentations, 25 lightning talks |
| 2026-09-03 (Thu) | 64 | 46 presentations, 18 lightning talks |

Earliest start `2026-09-01T09:00`, latest end `2026-09-03T17:45`, all local.

## 5. Transport, caching and errors

### Headers

The response carries **no cache-validation headers whatsoever** — no `ETag`, no
`Last-Modified`, no `Cache-Control`, no `Expires`:

```
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
vary: Accept-Encoding, User-Agent
server: Jetty(9.4.30.v20200611)
```

Consequences for the calendar:

- **Conditional requests are impossible.** `If-None-Match` / `If-Modified-Since` have
  nothing to match against; every poll transfers the full body.
- **Detect change client-side**: hash the normalised payload (or per-session field
  subset) and only rewrite the calendar when the hash moves.
- **Send `Accept-Encoding: gzip`** — it cuts 357 kB to 126 kB and the server honours it.
- `vary: User-Agent` means the CDN/origin keys on UA. Send a **stable, identifying**
  User-Agent (e.g. `javazone-calendar/1.0 (+contact)`); do not rotate it.

CORS is `*`, so a browser client can call this directly. No credentials, no preflight
needed for a simple GET.

### Polling

The programme changes rarely — talk edits before the conference, room/time moves during
it, `video` backfill after. There is no push mechanism and no rate-limit header,
so be conservative and behave like a good citizen:

- daily while the programme is being assembled,
- every 15–30 min during the three conference days, when reschedules actually happen,
- weekly for a month afterwards to pick up `video`, then stop.

Cache the last good payload on disk and serve it if a poll fails — a failed refresh
must never empty the calendar.

### Errors

Error responses are **HTML, not JSON** — a Jetty error page. Never assume the body
parses as JSON on a non-200.

| Situation | Status | Body |
|-----------|--------|------|
| Unknown slug (`javazone_2027`) | `400` | HTML, `<title>Error 400 Unknown slug javazone_2027</title>` |
| Trailing path segment on a valid slug | `500` | HTML, Jetty error page |
| `/public`, `/public/conferences` | `500` | HTML |
| `/data/conference/{id}/session`, `/data/session/{id}` | `401` | HTML — the write/submission API, not public |

Note the backend returns `500` for several malformed-path cases that are semantically
client errors. Treat any non-200 as "no fresh data" and fall back to cache.

### Not available

- No per-session endpoint. `/public/allSessions/{slug}/{sessionId}` is a `500`.
- No incremental / delta feed.
- No ICS, RSS or Atom feed from upstream — producing one is this project's reason to exist.
- No speaker photos, no session slides, no attendance/favourite counts.

## 6. Mapping to iCalendar

Recommended mapping for the calendar output:

| iCalendar property | Source |
|--------------------|--------|
| `UID` | `{id}@javazone.no` — `id` is stable across polls and years. |
| `DTSTART` | `startTimeZulu`, emitted as UTC (`...Z`) or converted to `Europe/Oslo` with a `VTIMEZONE`. |
| `DTEND` | `endTimeZulu`. |
| `SUMMARY` | `title`. Consider prefixing lightning talks / workshops with the format. |
| `LOCATION` | `room` (venue for 2026 is NOVA Spektrum, Lillestrøm — **not** in the payload; hardcode or omit). |
| `DESCRIPTION` | `abstract`, plus speaker names, `intendedAudience`, `language`, and `workshopPrerequisites` when present. |
| `CATEGORIES` | `format`, `language`, and split `suggestedKeywords` on `,` + trim. |
| `URL` | Session page on the programme site, if one exists per session. |
| `DTSTAMP` / `LAST-MODIFIED` | Fetch time — upstream exposes no modification timestamp. |
| `SEQUENCE` | Increment when a session's own fields change; needed for subscribers to see reschedules. |

Sanitise `abstract` and `workshopPrerequisites` for the target format — both contain
raw newlines, and iCalendar requires `\n` escaping plus 75-octet line folding.

## 7. Invariants and non-guarantees

Observed to hold across the 2025 and 2026 payloads:

- `id == sessionId` for every session.
- `conferenceId` is constant within a response and matches the index entry for the slug.
- `startSlot == startTime` and `startSlotZulu == startTimeZulu` for every session.
- `int(length)` equals the `endTime - startTime` delta in minutes.
- `speakers` is non-empty.

**None of these are contractual.** The API is undocumented and unversioned, published
for the conference's own site. Assume it can change without notice, and in particular:

- fields may appear or disappear between editions (`video`, `audience`, `state` have
  come and gone),
- enum values may gain members,
- room naming schemes change yearly,
- the URL itself could move when the site is rebuilt.

Validate the response shape on every fetch (at minimum: `sessions` is an array, and each
kept session has `id`, `title`, `startTimeZulu`, `endTimeZulu`), log and skip sessions
that fail, and never let a schema surprise take down the whole calendar.

## 8. Appendix: JSON Schema (descriptive)

Describes the 2026 payload. `additionalProperties` is deliberately open — upstream
adds fields between editions.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Sleeping Pill allSessions response",
  "type": "object",
  "required": ["sessions"],
  "properties": {
    "sessions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id", "sessionId", "conferenceId", "title", "abstract",
          "intendedAudience", "suggestedKeywords", "format", "length",
          "language", "room", "startTime", "endTime", "startTimeZulu",
          "endTimeZulu", "startSlot", "startSlotZulu", "speakers"
        ],
        "properties": {
          "id":                    { "type": "string", "format": "uuid" },
          "sessionId":             { "type": "string", "format": "uuid" },
          "conferenceId":          { "type": "string", "format": "uuid" },
          "title":                 { "type": "string", "minLength": 1 },
          "abstract":              { "type": "string" },
          "intendedAudience":      { "type": "string" },
          "suggestedKeywords":     { "type": "string" },
          "format":                { "type": "string",
                                     "examples": ["presentation", "lightning-talk", "workshop"] },
          "length":                { "type": "string", "pattern": "^[0-9]+$" },
          "language":              { "type": "string", "examples": ["en", "no"] },
          "room":                  { "type": "string" },
          "startTime":             { "type": "string",
                                     "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$" },
          "endTime":               { "type": "string",
                                     "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$" },
          "startSlot":             { "type": "string",
                                     "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$" },
          "startTimeZulu":         { "type": "string", "format": "date-time" },
          "endTimeZulu":           { "type": "string", "format": "date-time" },
          "startSlotZulu":         { "type": "string", "format": "date-time" },
          "workshopPrerequisites": { "type": "string" },
          "video":                 { "type": "string", "pattern": "^[0-9]+$",
                                     "description": "Bare Vimeo ID, added post-conference" },
          "speakers": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "required": ["name", "bio"],
              "properties": {
                "name":     { "type": "string" },
                "bio":      { "type": "string" },
                "linkedin": { "type": "string" },
                "bluesky":  { "type": "string" },
                "twitter":  { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

## 9. Re-verifying this document

```bash
# conference index
curl -s https://sleepingpill.javazone.no/public/allSessions | jq '.conferences[-3:]'

# full programme, field presence census
curl -s --compressed https://sleepingpill.javazone.no/public/allSessions/javazone_2026 \
  | jq -r '.sessions[] | keys[]' | sort | uniq -c | sort -rn

# response headers
curl -s -o /dev/null -D - https://sleepingpill.javazone.no/public/allSessions/javazone_2026
```

If the site is rebuilt, re-derive the endpoint by grepping the SPA bundle referenced from
`https://2026.javazone.no/program/` for `sleepingpill` or `allSessions`.
