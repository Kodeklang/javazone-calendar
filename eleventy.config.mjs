import { mkdirSync } from "node:fs";
import { FONT_DIR, buildFonts } from "./lib/fonts.mjs";
import site from "./src/_data/site.js";

// Created up front so the passthrough copies below have something to point at
// on a clean checkout: before any face has been subset, and before
// scripts/fetch-photos.mjs has ever run.
mkdirSync(FONT_DIR, { recursive: true });
mkdirSync("src/photos", { recursive: true });

export default function (eleventyConfig) {
  // Subset the webfonts before anything else runs. Passthrough copy happens
  // ahead of the data cascade, so generating them from the data file alone
  // would publish an empty directory on a cold build.
  eleventyConfig.on("eleventy.before", buildFonts);

  // Named individually rather than copying src/css wholesale: the originals in
  // src/css/fonts are the input to the subsetter, not something to publish.
  eleventyConfig.addPassthroughCopy({ "src/css/style.css": "css/style.css" });
  eleventyConfig.addPassthroughCopy({ "src/css/fonts.css": "css/fonts.css" });
  eleventyConfig.addPassthroughCopy({ [FONT_DIR]: "css/fonts" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/icons": "icons" });
  eleventyConfig.addPassthroughCopy({ "src/photos": "photos" });
  eleventyConfig.addPassthroughCopy({ "src/root": "." });

  // The RUM SDK ships a prebuilt bundle, so it needs no bundler of our own.
  // The slim build has no session replay recorder, so unlike the full one it
  // fetches no chunks at runtime and only this single file has to travel. Its
  // directory also holds a Salesforce variant we have no use for, hence naming
  // the file rather than copying the directory.
  eleventyConfig.addPassthroughCopy({
    "node_modules/@datadog/browser-rum-slim/bundle/datadog-rum-slim.js":
      "js/datadog/datadog-rum-slim.js",
  });

  // Norwegian-style time, always in the conference's own timezone so the build
  // does not depend on the machine it runs on.
  const hhmm = new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  eleventyConfig.addFilter("time", (iso) => hhmm.format(new Date(iso)));
  eleventyConfig.addFilter("duration", (min) =>
    min >= 60 ? `${Math.floor(min / 60)} t${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`);
  eleventyConfig.addFilter("durationEn", (min) =>
    min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`);

  // Absolute URL for og:url and og:image, which unfurlers ignore if relative.
  // Composes through Eleventy's own `url` filter first so a
  // PATH_PREFIX=/javazone-calendar/ build gets the prefix folded in exactly
  // once, then joins that onto site.url - already stripped of any trailing
  // slash - so the result never carries a `//` regardless of how the path
  // was spelled.
  eleventyConfig.addFilter("absUrl", (path) => site.url + eleventyConfig.getFilter("url")(path));

  return {
    // The site is served from the root of its own domain. Override with
    // PATH_PREFIX=/javazone-calendar/ to build for the bare github.io project
    // URL instead.
    pathPrefix: process.env.PATH_PREFIX ?? "/",
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
