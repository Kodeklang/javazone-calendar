#!/usr/bin/env node
// Downloads speaker profile photos and writes them to src/photos as small
// square WebP, plus a manifest at src/_data/photos.json that site.js reads.
//
//   node scripts/fetch-photos.mjs        (after scripts/fetch-program.mjs)
//
// Bluesky is the only source. Sleeping Pill publishes no photos of its own
// (docs/sleepingpill-api.md §5) and neither does JavaZone's own site, which
// reads the same API - so the speakers' social links are all there is. Of the
// three that upstream carries:
//
//   bluesky   a documented, unauthenticated, CORS-open XRPC API. Used here.
//   twitter   no public API since 2023. Only reachable through a third-party
//             avatar proxy, which rate-limits and answers with a generic
//             fallback face rather than a 404 when it finds nothing.
//   linkedin  the photo is in og:image on the public profile, but roughly half
//             of all requests come back HTTP 999, some of the rest carry the
//             grey default silhouette, and /in/ is disallowed in their
//             robots.txt. Not usable, and it is the one most speakers have.
//
// So most speakers have no photo here and keep the monogram, which is why the
// two are drawn to identical geometry in style.css. That is the steady state,
// not a gap waiting to be filled.
//
// Re-runnable by design: a Bluesky avatar URL ends in the blob's CID, so the
// URL *is* the content hash. An unchanged avatar is recognised from the
// manifest and never re-downloaded or re-encoded, which keeps a run over an
// unchanged programme free of both traffic and git churn.

import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROGRAM_FILE = path.join(ROOT, "src/_data/program.json");
const MANIFEST_FILE = path.join(ROOT, "src/_data/photos.json");
const PHOTO_DIR = path.join(ROOT, "src/photos");

const API = "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile";
const UA = "javazone-calendar/1.0 (+https://javazone.kodeklang.dev)";

// 120px covers every slot the design has: the speaker card draws the avatar at
// 60px, and 46px on narrow screens, so this is exactly 2x the larger of the
// two. One size rather than a srcset - at these dimensions the second file
// would save a couple of kilobytes and cost a build-time abstraction.
const SIZE = 120;
const QUALITY = 82;

// Bluesky answers in a few hundred milliseconds and this is 60 requests, so
// there is nothing to gain from opening more; being a well-behaved client of
// somebody else's free API is worth more than the second or two.
const CONCURRENCY = 5;
const RETRIES = 2;

// A transient outage must not look like "every speaker deleted their avatar"
// and prune 60 committed files. Past this share of unexpected failures the run
// writes nothing at all and exits non-zero.
const MAX_ERROR_RATE = 0.5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `worker` over every item, at most CONCURRENCY at a time.
 *
 * Results come back in the input's order rather than completion order, so an
 * unchanged programme produces an identically ordered manifest.
 */
async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runner = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, runner));
  return results;
}

/** Fetch with a couple of retries, for the network rather than for 4xx. */
async function get(url, accept) {
  let last;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) await sleep(400 * attempt);
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept } });
      // A 4xx is an answer - the handle is gone, or was never right - and
      // retrying it only wastes somebody else's rate limit.
      if (res.status >= 400 && res.status < 500) return res;
      if (!res.ok) { last = new Error(`HTTP ${res.status}`); continue; }
      return res;
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

/**
 * The CID at the end of a Bluesky avatar URL, which identifies the image
 * bytes. Falls back to the whole URL if the shape ever changes, so an
 * unrecognised URL re-downloads rather than being taken for unchanged.
 */
const cidOf = (url) => url.match(/\/([a-z0-9]{40,})(?:@[a-z]+)?$/i)?.[1] ?? url;

/**
 * Every spelling of a handle worth trying, most literal first.
 *
 * A Bluesky handle is a domain, but the speaker form takes free text and a
 * third of the entries are a bare word - "gsaab", "jhannes" - which resolves
 * to nothing as written. Appending the default domain recovers six of them.
 * A handle that already contains a dot is either a custom domain or already
 * suffixed, so it is only ever tried as given.
 */
const spellings = (handle) =>
  handle.includes(".") ? [handle] : [handle, `${handle}.bsky.social`];

/**
 * Resolve one handle to its avatar URL, and to the spelling that found it.
 *
 * Returns null when the account cannot be found or has set no avatar. Neither
 * is an error: the speaker simply has no photo here, and the monogram is a
 * perfectly good answer.
 */
async function avatarUrl(handle) {
  for (const actor of spellings(handle)) {
    const res = await get(`${API}?actor=${encodeURIComponent(actor)}`, "application/json");
    // Unknown handle, or one too malformed for the API to look up at all.
    if (res.status === 400 || res.status === 404) continue;
    if (!res.ok) throw new Error(`getProfile ${actor}: HTTP ${res.status}`);
    const body = await res.json();
    if (typeof body.avatar === "string" && body.avatar) return { url: body.avatar, actor };
    return null; // the account is real and simply has no avatar on it
  }
  return null;
}

/** Download an avatar and write it as a square WebP. */
async function writePhoto(url, file) {
  const res = await get(url, "image/webp,image/*");
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const source = Buffer.from(await res.arrayBuffer());

  // Sources are square 1000x1000 today, so the cover crop is usually a no-op;
  // it is here for the day one is not, and centre rather than sharp's
  // attention strategy because a portrait's subject is the middle of the frame
  // and a deterministic crop keeps re-runs byte-identical.
  const out = await sharp(source)
    .resize(SIZE, SIZE, { fit: "cover", position: "centre" })
    .webp({ quality: QUALITY, effort: 6 })
    .toBuffer();

  await writeFile(path.join(PHOTO_DIR, file), out);
  return out.length;
}

// -------------------------------------------------------------------- main

const program = JSON.parse(await readFile(PROGRAM_FILE, "utf8"));

// The previous run's manifest, so an unchanged avatar can be recognised. A
// missing one is a cold start, not a problem.
const previous = await readFile(MANIFEST_FILE, "utf8")
  .then((s) => JSON.parse(s).speakers ?? {})
  .catch(() => ({}));

await mkdir(PHOTO_DIR, { recursive: true });
const onDisk = new Set(
  (await readdir(PHOTO_DIR).catch(() => [])).filter((f) => f.endsWith(".webp")),
);

const candidates = program.speakers
  .filter((s) => s.links?.bluesky)
  .map((s) => ({ id: s.id, name: s.name, handle: s.links.bluesky, file: `${s.id}.webp` }));

let fetched = 0, reused = 0, bytes = 0;
const errors = [];

const entries = await pool(candidates, async (speaker) => {
  const { id, name, handle, file } = speaker;
  try {
    const found = await avatarUrl(handle);
    if (!found) return null; // no account, or no avatar set on it

    const cid = cidOf(found.url);
    const before = previous[id];
    if (before?.cid === cid && before.handle === found.actor && onDisk.has(file)) {
      reused++;
      return [id, before];
    }

    // Read into a local first: `bytes += await ...` would sample `bytes`
    // before suspending, and the workers running alongside this one would
    // lose their additions to the stale value written back on resume.
    const written = await writePhoto(found.url, file);
    bytes += written;
    fetched++;
    return [id, { handle: found.actor, cid, file }];
  } catch (err) {
    errors.push(`${name} (@${handle}): ${err.message}`);
    // Keep whatever the last good run found. A speaker must not lose their
    // photo because Bluesky was briefly unreachable.
    return previous[id] && onDisk.has(previous[id].file) ? [id, previous[id]] : null;
  }
});

for (const line of errors) console.warn(`  ! ${line}`);

if (candidates.length && errors.length > candidates.length * MAX_ERROR_RATE) {
  throw new Error(
    `${errors.length} of ${candidates.length} lookups failed — refusing to write`,
  );
}

// Sorted, so an unchanged programme keeps producing identical bytes.
const speakers = Object.fromEntries(
  entries.filter(Boolean).sort(([a], [b]) => a.localeCompare(b)),
);

await writeFile(
  MANIFEST_FILE,
  JSON.stringify({ size: SIZE, source: "bluesky", speakers }, null, 2) + "\n",
);

// Anything the manifest no longer claims: a speaker off this year's programme,
// one who dropped their Bluesky link, or an avatar taken down.
const keep = new Set(Object.values(speakers).map((p) => p.file));
const stale = [...onDisk].filter((f) => !keep.has(f)).sort();
for (const file of stale) await unlink(path.join(PHOTO_DIR, file));

const count = Object.keys(speakers).length;
console.log(
  `${count} photos for ${program.speakers.length} speakers ` +
  `(${fetched} fetched${bytes ? `, ${Math.round(bytes / 1024)} kB` : ""}, ${reused} unchanged` +
  `${stale.length ? `, ${stale.length} pruned` : ""}` +
  `${errors.length ? `, ${errors.length} failed` : ""})`,
);
