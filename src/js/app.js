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

/* ---------------------------------------------------------------- picks */

// The sessions someone has marked as one they want to see. Their own list, so
// it gets a key of its own rather than a corner of jz-filters: "Alt" wipes a
// filter selection, and it must never take the list with it.
//
// localStorage rather than a cache or IndexedDB, on three counts. It is
// origin-scoped, so the installed app and a browser tab are reading the same
// list. It outlives every service worker activation - the worker owns only the
// jz-<build> cache, which a deploy retires wholesale, and storage is not in it.
// And it is synchronous, so the list is in hand before the first paint and a
// marked card is never drawn unmarked and then corrected.
//
// None of it is baked into the HTML, for the reason at the top of this file:
// the pages are precached and identical for everyone, so the marks are put on
// here, at runtime, on top of a build that knows nothing about them.

const PICKS_KEY = "jz-picks";
const onPicksChange = [];

function storedPicks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PICKS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v) => typeof v === "string"));
  } catch {
    // Hand-edited or truncated storage: nothing marked beats throwing on load.
    return new Set();
  }
}

function storePicks(picks) {
  if (picks.size) localStorage.setItem(PICKS_KEY, JSON.stringify([...picks]));
  else localStorage.removeItem(PICKS_KEY);
}

let picks = storedPicks();

const picksChanged = () => {
  for (const fn of onPicksChange) fn();
};

// Returning from a session page is history.back() (see #back below), which can
// restore the grid from the bfcache exactly as it was left - including its
// marks, made before the visitor went and changed one. Nothing ran in between
// to notice, so re-read rather than trust what is on screen.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  picks = storedPicks();
  picksChanged();
});

// Two tabs on a desktop - the grid in one, a session in the other - are the
// same list seen twice, and `storage` fires in every tab but the one that
// wrote. Without this the grid would sit on a stale list until it reloaded.
window.addEventListener("storage", (event) => {
  if (event.key !== null && event.key !== PICKS_KEY) return;
  picks = storedPicks();
  picksChanged();
});

/* ----------------------------------------------------------- pick button */

const pickButton = document.getElementById("pick");

if (pickButton) {
  // The markup ships it hidden, because without script there is nowhere to
  // keep the answer.
  pickButton.hidden = false;

  const id = pickButton.dataset.session;
  const render = () => pickButton.setAttribute("aria-pressed", String(picks.has(id)));

  pickButton.addEventListener("click", () => {
    // Read storage again rather than trusting the in-memory copy: another tab
    // may have marked something since this page loaded, and writing the whole
    // list back from a stale Set would silently drop it.
    picks = storedPicks();
    if (picks.has(id)) picks.delete(id);
    else picks.add(id);
    storePicks(picks);
    render();
  });

  onPicksChange.push(render);
  render();
}

/* -------------------------------------------------------- facet filter */

// Two independent facets, because Sleeping Pill publishes no track: format
// (presentation, lightning talk, workshop) and language. Chips within one
// facet are alternatives; the two facets narrow each other. Picking "Lyntale"
// and "Norsk" means the Norwegian lightning talks, which is the question
// someone standing in a corridor actually has.
//
// Filtering de-emphasises rather than removes. A session outside the selection
// is greyed out but stays exactly where it is, so the grid keeps its shape,
// nothing reflows under the reader, and a talk that nearly matched is still
// there to be seen. Picking nothing shows the whole day at full strength.
//
// Because nothing leaves the grid, nothing leaves the accessibility tree
// either - so the live region reports how many matched rather than being the
// only remaining evidence of what happened.
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

    let matched = 0;
    for (const session of allSessions) {
      const on = FACETS.every((facet) => {
        if (!picked[facet].size) return true;
        return picked[facet].has(session.dataset[facet] || "");
      });
      // No selection at all means no dimming: an unfiltered grid is not a grid
      // where everything happens to match.
      session.classList.toggle("is-dimmed", anyPicked && !on);
      if (on) matched += 1;
    }

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
    const what = names.join(" + ");
    // Nothing was removed, so this counts what stands out rather than what is
    // left: "8 of 79 highlighted" is the honest description of the grid now.
    const total = allSessions.length;
    filterStatus.textContent = lang === "en"
      ? `${what}: ${matched} of ${total} ${total === 1 ? "session" : "sessions"} highlighted, the rest dimmed`
      : `${what}: ${matched} av ${total} ${total === 1 ? "sesjon" : "sesjoner"} markert, resten nedtonet`;
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

/* ------------------------------------------------------------- copy link */

const copyButton = document.getElementById("copy-link");

if (copyButton) {
  const copyLabel = document.getElementById("copy-label");
  const copyStatus = document.getElementById("copy-status");

  // The markup ships it hidden. Reading the clipboard API is the whole of what
  // this control does, so it only earns its place once there is script to do it.
  copyButton.hidden = false;

  const FLASH_MS = 1800;
  let flashTimer;

  // This site's own address for the session, not javazone.no's: the point of
  // the button is to hand someone the page being looked at. Rebuilt from
  // origin and path rather than taken from location.href, so a "?v=" or a
  // "#session-..." picked up on the way here is not passed on to anyone else.
  const sessionUrl = () => location.origin + location.pathname;

  const resting = (lang) => (lang === "en" ? copyLabel.dataset.en : copyLabel.dataset.no);

  const flash = (ok) => {
    const lang = currentLang();
    // Said out loud as well as shown. The label changing under the pointer is
    // the whole feedback for a sighted visitor and none of it for a screen
    // reader, which would otherwise be told nothing happened at all.
    copyLabel.textContent = ok
      ? (lang === "en" ? "Copied" : "Kopiert")
      : (lang === "en" ? "Couldn't copy" : "Kunne ikke kopiere");
    copyStatus.textContent = ok
      ? (lang === "en" ? "Link copied to the clipboard" : "Lenken er kopiert")
      : (lang === "en" ? "Could not copy the link" : "Kunne ikke kopiere lenken");

    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      copyLabel.textContent = resting(currentLang());
      copyStatus.textContent = "";
    }, FLASH_MS);
  };

  // Everything current reaches the first branch: this site is HTTPS, and
  // localhost counts as a secure context too. The second is for a checkout
  // served over plain HTTP on a LAN address, where navigator.clipboard is
  // simply absent - deprecated, but it is what still works there.
  const write = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    // Off-screen rather than hidden: a display:none field cannot be selected.
    field.style.cssText = "position:fixed;top:-9999px;opacity:0";
    document.body.appendChild(field);
    field.select();
    try {
      if (!document.execCommand("copy")) throw new Error("execCommand refused");
    } finally {
      field.remove();
    }
  };

  copyButton.addEventListener("click", async () => {
    try {
      await write(sessionUrl());
      flash(true);
    } catch {
      // Permission refused, or no clipboard at all. Saying so beats a label
      // that claims a copy the visitor will not find when they paste.
      flash(false);
    }
  });

  // applyLang rewrites the label from its data-* pair, so a switch mid-flash
  // already lands on the right resting text; this just drops the timer that
  // would otherwise rewrite it a second time, and clears the stale
  // announcement left in the language nobody is reading any more.
  onLangChange.push(() => {
    clearTimeout(flashTimer);
    copyStatus.textContent = "";
  });
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

// A deploy changes site.buildId, and buildId is what names the service
// worker's cache. So the worker carrying a new build brings a fresh copy of
// the whole programme - every page at once, not the one being looked at - and
// getting that worker in *is* the update. It activates, claims this page, and
// the controllerchange handler below reloads into the new build.
//
// This poll exists only for a window that never navigates. The browser checks
// sw.js on navigation by itself, so a visitor moving around the programme is
// already covered; a phone left open on one talk for an afternoon is not, and
// would otherwise sit on the build it was opened with.
//
// Compared against the build rather than the programme hash on purpose. The
// programme hash misses a layout change entirely - new photos on the detail
// pages moved every rendered page without moving it - which left those pages
// stale with nothing to notice it.
const built = document.querySelector('meta[name="app-build"]')?.content;
let asking = false;

async function checkForUpdate() {
  if (!built || asking) return;
  asking = true;
  try {
    // no-cache still revalidates, so this is a 304 with no body until a deploy
    // actually lands.
    const res = await fetch(`${BASE}version.json`, { cache: "no-cache" });
    if (!res.ok) return;
    const { build } = await res.json();
    if (!build || build === built) return;
    // Nothing further to do here. The new worker skipWaiting()s as it
    // installs, and the reload is on controllerchange.
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    /* offline, or no worker: the next tick tries again */
  } finally {
    asking = false;
  }
}

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
