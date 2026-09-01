// Everything here is either time-dependent or a user preference, which is
// exactly what may not be baked into the HTML: the build must stay
// byte-identical for an unchanged programme.

const LANG_KEY = "jz-lang";
// GitHub Pages can serve this under /<repo>/, so nothing may assume the root.
const BASE = document.querySelector('meta[name="base-path"]')?.content || "/";
const onLangChange = [];

/* ------------------------------------------------------------- language */

function currentLang() {
  return localStorage.getItem(LANG_KEY) === "en" ? "en" : "no";
}

function applyLang(lang) {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-en]")) {
    // Remember the Norwegian original the first time we touch an element.
    if (el.dataset.no === undefined) el.dataset.no = el.textContent.trim();
    el.textContent = lang === "en" ? el.dataset.en : el.dataset.no;
  }
  for (const fn of onLangChange) fn(lang);
}

const langButton = document.getElementById("lang");
if (langButton) {
  langButton.addEventListener("click", () => {
    const next = currentLang() === "en" ? "no" : "en";
    localStorage.setItem(LANG_KEY, next);
    applyLang(next);
  });
}
applyLang(currentLang());

/* -------------------------------------------------------- facet filter */

// Two independent facets, because Sleeping Pill publishes no track: format
// (presentation, lightning talk, workshop) and language. Chips within one
// facet are alternatives; the two facets narrow each other. Picking "Lyntale"
// and "Norsk" means the Norwegian lightning talks, which is the question
// someone standing in a corridor actually has.
//
// Filtering is a real filter, not a de-emphasis: rooms nothing survives in
// collapse away, and every other session leaves the grid - and with it the
// accessibility tree, which is why the live region below reports what
// survived. Picking nothing shows the whole day.
//
// The selection spans days. A day only applies the values it actually runs;
// the rest stay stored, so stepping to a day without them and back does not
// quietly drop them.

const FILTER_KEY = "jz-filters";
const FACETS = ["format", "language"];
const chips = document.querySelectorAll(".chip[data-facet]");
const resetChip = document.getElementById("filter-reset");
const allSessions = document.querySelectorAll(".session[data-format]");
const filterStatus = document.getElementById("filter-status");

const emptySelection = () => Object.fromEntries(FACETS.map((f) => [f, []]));

function storedFilters() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return emptySelection();
    return Object.fromEntries(FACETS.map((facet) => [
      facet,
      Array.isArray(parsed[facet]) ? parsed[facet].filter((v) => typeof v === "string") : [],
    ]));
  } catch {
    // Hand-edited or truncated storage: fall back to showing everything.
    return emptySelection();
  }
}

function storeFilters(selection) {
  const any = FACETS.some((f) => selection[f].length);
  if (any) localStorage.setItem(FILTER_KEY, JSON.stringify(selection));
  else localStorage.removeItem(FILTER_KEY);
}

if (chips.length) {
  // What this particular day actually offers, so a value carried over from
  // another day is kept in storage but not applied here.
  const offered = Object.fromEntries(FACETS.map((f) => [f, new Set()]));
  const labels = new Map();
  for (const chip of chips) {
    offered[chip.dataset.facet]?.add(chip.dataset.value);
    labels.set(`${chip.dataset.facet}:${chip.dataset.value}`, chip);
  }

  const forToday = () => {
    const stored = storedFilters();
    return Object.fromEntries(
      FACETS.map((f) => [f, stored[f].filter((v) => offered[f].has(v))]),
    );
  };

  const gridEl = document.querySelector(".grid");
  const columned = gridEl ? gridEl.querySelectorAll("[data-col]") : [];
  const roomCount = gridEl ? Number(gridEl.style.getPropertyValue("--rooms")) : 0;

  /**
   * Collapse every room the selection does not reach. Columns are zeroed
   * rather than renumbered, so nothing else on the grid has to move. A null
   * `keep` means no filter at all. Returns how many rooms survived.
   */
  const applyColumns = (keep) => {
    if (!gridEl) return 0;
    if (!keep) {
      gridEl.style.removeProperty("--cols");
      gridEl.style.setProperty("--visible-rooms", String(roomCount));
      for (const el of columned) el.classList.remove("is-collapsed");
      return roomCount;
    }
    const widths = [];
    for (let col = 2; col < roomCount + 2; col++) {
      widths.push(keep.has(String(col)) ? "minmax(var(--col-w), 1fr)" : "0px");
    }
    gridEl.style.setProperty("--cols", `var(--gutter-w) ${widths.join(" ")}`);
    gridEl.style.setProperty("--visible-rooms", String(Math.max(keep.size, 1)));
    for (const el of columned) {
      el.classList.toggle("is-collapsed", !keep.has(el.dataset.col));
    }
    return keep.size;
  };

  // `announce` guards the live region: only a real click should speak. Writing
  // it on load or on a language switch would just be noise.
  const applyFilters = (selection, { announce = false, lang = currentLang() } = {}) => {
    const picked = Object.fromEntries(FACETS.map((f) => [f, new Set(selection[f])]));
    const anyPicked = FACETS.some((f) => picked[f].size);

    for (const chip of chips) {
      const facet = chip.dataset.facet;
      const on = picked[facet].has(chip.dataset.value);
      chip.setAttribute("aria-pressed", String(on));
      // Muted within its own group only: a language pick must not grey out
      // every format chip, since the two narrow independently.
      chip.classList.toggle("is-muted", picked[facet].size > 0 && !on);
    }
    resetChip?.setAttribute("aria-pressed", String(!anyPicked));

    // Which columns survive is read off the sessions that survive, rather than
    // precomputed per chip: with two facets that intersect, no per-chip column
    // list could answer for a combination of them.
    const keep = anyPicked ? new Set() : null;
    let shown = 0;
    for (const session of allSessions) {
      const on = FACETS.every((facet) => {
        if (!picked[facet].size) return true;
        return picked[facet].has(session.dataset[facet] || "");
      });
      session.classList.toggle("is-filtered-out", !on);
      if (on) {
        shown += 1;
        keep?.add(session.dataset.col);
      }
    }
    const rooms = applyColumns(keep);

    if (!filterStatus) return;
    if (!announce) {
      filterStatus.textContent = "";
      return;
    }
    if (!anyPicked) {
      filterStatus.textContent = lang === "en" ? "Showing everything" : "Viser alt";
      return;
    }
    const names = FACETS.flatMap((facet) =>
      [...picked[facet]].map((v) => labels.get(`${facet}:${v}`)?.textContent.trim() ?? v),
    );
    const what = names.join(lang === "en" ? " + " : " + ");
    filterStatus.textContent = lang === "en"
      ? `Showing ${what}: ${shown} ${shown === 1 ? "session" : "sessions"} in ${rooms} ${rooms === 1 ? "room" : "rooms"}`
      : `Viser ${what}: ${shown} ${shown === 1 ? "sesjon" : "sesjoner"} i ${rooms} rom`;
  };

  for (const chip of chips) {
    chip.addEventListener("click", () => {
      // Each chip toggles its own value; clicking the last one off in a facet
      // clears that facet, which is the same thing as picking nothing in it.
      const { facet, value } = chip.dataset;
      const all = storedFilters();
      all[facet] = all[facet].includes(value)
        ? all[facet].filter((v) => v !== value)
        : [...all[facet], value];
      storeFilters(all);
      applyFilters(forToday(), { announce: true });
    });
  }

  // Clearing two facets a chip at a time is a chore, and on a day with eleven
  // chips it is the only quick way back to the whole programme.
  resetChip?.addEventListener("click", () => {
    localStorage.removeItem(FILTER_KEY);
    applyFilters(emptySelection(), { announce: true });
  });

  // Switching language strands the announcement in the old one; re-applying
  // clears it. This is also what carries the choice across days.
  onLangChange.push((lang) => applyFilters(forToday(), { lang }));

  const initial = forToday();
  applyFilters(initial);
  const firstPicked = [...chips].find(
    (c) => initial[c.dataset.facet]?.includes(c.dataset.value),
  );
  if (firstPicked) {
    // Carried over from another day, the chip may sit off-screen in the
    // horizontally scrolling row - show why the grid is filtered.
    firstPicked.scrollIntoView({ inline: "center", block: "nearest" });
  }
}

/* ------------------------------------------------------------- now line */

const grid = document.querySelector(".grid");
const nowLine = document.getElementById("now");

if (grid && nowLine) {
  const dayStart = Date.parse(grid.dataset.dayStart);
  const slotMin = Number(grid.dataset.slotMin) || 5;
  const totalMin = Number(grid.style.getPropertyValue("--slots")) * slotMin;
  const nowTime = document.getElementById("now-time");
  const clock = new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  let placed = false;

  const tick = () => {
    const minutes = (Date.now() - dayStart) / 60_000;
    if (minutes < 0 || minutes > totalMin) {
      nowLine.hidden = true;
      return false;
    }
    grid.style.setProperty("--now-min", minutes.toFixed(2));
    nowTime.textContent = clock.format(new Date());
    nowLine.hidden = false;
    return true;
  };

  if (tick()) {
    // Open scrolled to the now-line, a little above centre.
    const scroller = document.getElementById("grid-scroll");
    requestAnimationFrame(() => {
      if (placed) return;
      placed = true;
      scroller.scrollTop = Math.max(0, nowLine.offsetTop - scroller.clientHeight * 0.42);
    });
  }
  setInterval(tick, 30_000);
}

/* ------------------------------------------------------------- countdown */

const countdown = document.getElementById("countdown");

if (countdown) {
  const start = Date.parse(countdown.dataset.start);
  const end = Date.parse(countdown.dataset.end);

  const render = (lang) => {
    const now = Date.now();
    if (now >= end) {
      countdown.textContent = lang === "en" ? "Finished" : "Ferdig";
      return;
    }
    if (now >= start) {
      countdown.textContent = lang === "en" ? "On now" : "Pågår nå";
      return;
    }
    // Days, then hours, then minutes. Unlike a festival someone is already at,
    // a JavaZone talk is often looked up weeks ahead, and "54 t 33 min" is not
    // a length of time anybody reads as two and a bit days.
    const mins = Math.round((start - now) / 60_000);
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    const span = d
      ? (lang === "en" ? `${d}d ${h}h` : `${d} d ${h} t`)
      : h
        ? `${h}${lang === "en" ? "h" : " t"} ${m} min`
        : `${m} min`;
    countdown.textContent = lang === "en" ? `${span} to start` : `${span} til start`;
  };

  onLangChange.push(render);
  render(currentLang());
  setInterval(() => render(currentLang()), 30_000);
}

/* ------------------------------------------------------------------ back */

// The href is a real link to the day grid so this works without JS; when the
// visitor actually came from the grid, going back preserves their scroll.
const back = document.getElementById("back");
if (back && document.referrer) {
  try {
    const from = new URL(document.referrer);
    // Day one sits at the root; the other days under /dag/.
    const fromGrid = from.pathname === BASE || from.pathname.startsWith(`${BASE}dag/`);
    if (from.origin === location.origin && fromGrid) {
      back.addEventListener("click", (event) => {
        event.preventDefault();
        history.back();
      });
    }
  } catch {
    /* malformed referrer: keep the plain link */
  }
}

/* ---------------------------------------------------------- programme update */

const banner = document.getElementById("update");
const built = document.querySelector('meta[name="app-version"]')?.content;

async function checkForUpdate() {
  if (!banner || !built) return;
  try {
    // no-cache still revalidates, so this is a 304 with no body until the
    // programme actually changes.
    const res = await fetch(`${BASE}version.json`, { cache: "no-cache" });
    if (!res.ok) return;
    const { version } = await res.json();
    if (version && version !== built) banner.hidden = false;
  } catch {
    /* offline: try again later */
  }
}

// Reloading on its own is not enough. Navigations are served from the cache, so
// the reload renders the very page the banner is complaining about and the
// banner comes back with it. Normally the new worker settles that within a
// second - it takes over and reloads the document itself - but that handoff
// needs the browser to notice a new sw.js, which iOS Safari checks for far less
// eagerly than Chrome and a CDN can hold back for its own cache lifetime. A
// button that only works once the worker cooperates is a button that looks
// broken. So fetch this page past every cache first, store it, and reload into
// it.
async function reloadWithFreshPage() {
  try {
    const response = await fetch(location.href, { cache: "reload" });
    if (response.ok && window.caches) {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        // Only replace a copy that is actually held, so this never seeds a page
        // into a cache the worker is on its way to deleting.
        if (await cache.match(location.href)) {
          await cache.put(location.href, response.clone());
        }
      }
    }
    // Nudge the worker too, so the rest of the programme catches up behind us.
    await navigator.serviceWorker?.getRegistration().then((r) => r?.update());
  } catch {
    /* offline, or no cache to correct: the plain reload below still stands */
  }
  location.reload();
}

document.getElementById("update-reload")?.addEventListener("click", (event) => {
  event.currentTarget.disabled = true;
  reloadWithFreshPage();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkForUpdate();
});
checkForUpdate();
setInterval(checkForUpdate, 10 * 60_000);

/* --------------------------------------------------------- service worker */

if ("serviceWorker" in navigator) {
  // A page that is already controlled has loaded its CSS and JS from the old
  // worker's cache. When a new worker takes over it brings fresh assets, but
  // this document is still running the previous bundle - so reload once.
  // Without this every deploy would only reach people on their *second* visit.
  if (navigator.serviceWorker.controller) {
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }

  window.addEventListener("load", () => {
    // updateViaCache: "none" keeps sw.js itself off the HTTP cache, so a deploy
    // is noticed on the next visit rather than up to ten minutes later.
    navigator.serviceWorker
      .register(`${BASE}sw.js`, { scope: BASE, updateViaCache: "none" })
      .catch(() => {
        /* the site works fine without it */
      });
  });
}
