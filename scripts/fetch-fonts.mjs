#!/usr/bin/env node
// One-off: vendors Montserrat from Google Fonts into src/css/fonts so the site
// makes no third-party requests and works offline. Re-run only to change the
// weights; the downloaded files are committed.
//
// Only Montserrat. The design sets everything clock-like in
// `ui-monospace, SFMono-Regular, Menlo, monospace` - the system monospace -
// which costs nothing to download and is already installed everywhere.
//
// Five upright weights and one italic, all of which the design uses: 800 for
// the wordmark and the big headings, 700 for titles and chips, 600 for the
// small caps labels, 500 for the muted second lines, 400 for body text, and
// italic 400 for the speaker name on a grid card.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CSS_URL =
  "https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const SUBSETS = ["latin", "latin-ext"]; // enough for Norwegian and European names
const OUT = path.resolve(import.meta.dirname, "../src/css/fonts");

const css = await (await fetch(CSS_URL, { headers: { "user-agent": UA } })).text();
await mkdir(OUT, { recursive: true });

const kept = [];

// Google labels each @font-face with a "/* latin */" style comment.
for (const m of css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
  const subset = m[1];
  if (!SUBSETS.includes(subset)) continue;
  const body = m[2];
  const family = /font-family:\s*'([^']+)'/.exec(body)[1];
  const weight = /font-weight:\s*(\d+)/.exec(body)[1];
  const style = /font-style:\s*(\w+)/.exec(body)?.[1] ?? "normal";
  const url = /url\((https:\/\/[^)]+\.woff2)\)/.exec(body)[1];
  const range = /unicode-range:\s*([^;]+)/.exec(body)[1].trim();

  const slug = family.toLowerCase().replace(/\s+/g, "-");
  const file = `${slug}-${weight}${style === "italic" ? "i" : ""}-${subset}.woff2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  await writeFile(path.join(OUT, file), Buffer.from(await res.arrayBuffer()));
  kept.push({ family, weight, style, file, range });
}

if (!kept.length) throw new Error("no font faces matched — Google Fonts CSS format changed?");

const out = kept.map((f) => `@font-face {
  font-family: '${f.family}';
  font-style: ${f.style};
  font-weight: ${f.weight};
  font-display: swap;
  src: url('fonts/${f.file}') format('woff2');
  unicode-range: ${f.range};
}`).join("\n\n");

await writeFile(path.join(OUT, "..", "fonts.css"), out + "\n");
console.log(`${kept.length} font files vendored`);
