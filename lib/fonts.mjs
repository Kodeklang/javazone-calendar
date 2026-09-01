// Google's "latin" subset of Montserrat carries a few hundred glyphs and costs
// 38KB a weight. This site draws on a few hundred characters. Subsetting each
// face to the ones that can actually appear takes the six faces a page pulls
// from 624KB to a fraction of that.
//
// The character set is derived, not hand-written, because the programme is
// refetched hourly: a speaker called Przybył must not silently fall back to a
// system font. Everything that can reach the page is scanned - the programme
// itself, the Norwegian and English strings in the templates - on top of a base
// set covering Latin-1, which is where most European accents live. Anything
// rarer - Ł, ő, ș - is picked up from the programme on the build that
// introduces it, because the hourly workflow rebuilds whenever it changes.

import subsetFont from "subset-font";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const FONT_DIR = ".cache/fonts";

const SRC = fileURLToPath(new URL("../src/css/fonts/", import.meta.url));
const ROOT = fileURLToPath(new URL("../src/", import.meta.url));

/** Printable ASCII, Latin-1 letters, and the punctuation the templates use. */
function baseChars() {
  let s = "";
  for (let c = 0x20; c <= 0x7e; c++) s += String.fromCodePoint(c);
  // Latin-1 Supplement letters: the accents behind most European names.
  for (let c = 0xc0; c <= 0xff; c++) s += String.fromCodePoint(c);
  // Typographic punctuation the programme text and the templates rely on.
  return s + "‐‑‒–—‘’‚“”„•…‹›·«»´€";
}

/** Every character that any template or the programme itself can put on a page. */
export function siteChars() {
  let text = baseChars();
  text += readFileSync(path.join(ROOT, "_data/program.json"), "utf8");

  // Template literals: the Norwegian labels and their data-en counterparts.
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(njk|html)$/.test(entry.name)) text += readFileSync(p, "utf8");
    }
  };
  walk(ROOT);

  return [...new Set(text)].filter((c) => c.codePointAt(0) > 0x1f).sort().join("");
}

export async function buildFonts() {
  mkdirSync(FONT_DIR, { recursive: true });
  const chars = siteChars();

  for (const file of readdirSync(SRC).filter((f) => f.endsWith(".woff2"))) {
    const out = path.join(FONT_DIR, file);
    const source = readFileSync(path.join(SRC, file));
    // Each face keeps only the glyphs it actually has: passing the whole set to
    // a latin file and a latin-ext file lets each take its own share, and the
    // unicode-range in fonts.css still decides which one a browser fetches.
    const subset = await subsetFont(source, chars, { targetFormat: "woff2" });
    writeFileSync(out, subset);
  }
}

/**
 * The published names of the subset faces, for anything that has to enumerate
 * them - the service worker's precache list, above all. Read from the sources
 * rather than from FONT_DIR so the answer does not depend on buildFonts having
 * run yet; it writes one output per source, under the same name.
 */
export function fontFiles() {
  return readdirSync(SRC).filter((f) => f.endsWith(".woff2")).sort();
}
