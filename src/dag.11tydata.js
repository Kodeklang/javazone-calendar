// See program.11tydata.js for why this lives here rather than in dag.njk's
// front matter: a front-matter value is rendered as Nunjucks once on its
// own and then again by base.njk's `{{ title }}` / `{{ description }}`,
// double-escaping it. A function is not re-rendered as a template, so only
// base.njk's pass runs. The `day` pagination alias - day one of which is
// also the site's front page - is reached the same way it was before,
// through the computed-data `data` argument.
export default {
  eleventyComputed: {
    title: (data) => `${data.day.longLabel.no} · Program · JavaZone 2026`,
    description: (data) =>
      `Programmet for ${data.day.longLabel.no} på JavaZone 2026, ${data.site.event.venue}.`,
  },
};
