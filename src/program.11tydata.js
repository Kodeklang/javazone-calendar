// eleventyComputed here, rather than in program.njk's front matter, because
// front-matter values are rendered as Nunjucks templates before the page
// itself is: `{{ session.title }}` would already HTML-escape the title once,
// and then base.njk's `{{ title }}` would escape it again. A plain function
// is not re-rendered as a template, so the value passes through Nunjucks'
// escaping exactly once, in base.njk. The `session` pagination alias is
// still reached the same way, through the computed-data `data` argument.
export default {
  eleventyComputed: {
    title: (data) => `${data.session.title} · JavaZone 2026`,
    // Already plain prose, truncated to a word boundary - see
    // site.js's `metaDescription`, which is where the 160-character budget
    // and the entity decoding live so this file stays wiring only.
    description: (data) => data.session.metaDescription,
    back: (data) => `${data.session.day.url}#session-${data.session.id}`,
  },
};
