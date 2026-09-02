// See program.11tydata.js for why this lives here rather than in dag.njk's
// front matter: a front-matter value is rendered as Nunjucks once on its
// own and then again by base.njk's `{{ title }}` / `{{ description }}`,
// double-escaping it. A function is not re-rendered as a template, so only
// base.njk's pass runs. The `day` pagination alias - day one of which is
// also the site's front page - is reached the same way it was before,
// through the computed-data `data` argument.
const description = (data) =>
  `Programmet for ${data.day.longLabel.no} på JavaZone 2026, ${data.site.event.venue}.`;

export default {
  eleventyComputed: {
    title: (data) => `${data.day.longLabel.no} · Program · JavaZone 2026`,
    description,
    // `/` is day one's grid, but it is also the site's most-shared URL, and
    // a share card that leads with "Tirsdag 1. september" is a worse hook
    // than the event's own name. og:site_name already names the site on
    // every card, so the front page's own og:title repeats that name rather
    // than the derived day title - the other two days keep their day name,
    // the title minus its " · JavaZone 2026" suffix.
    shareTitle: (data) =>
      data.day.index === 0 ? "JavaZone 2026 — program" : `${data.day.longLabel.no} · Program`,
    shareDescription: description,
  },
};
