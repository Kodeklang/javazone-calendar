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
    // The title minus its own " · JavaZone 2026" suffix: og:site_name
    // already carries the site's name on the card, so og:title need not.
    shareTitle: (data) => data.session.title,
    // Day, time, room and speaker ahead of the abstract - see site.js's
    // `shareDescription` for why a share card wants the facts first.
    shareDescription: (data) => data.session.shareDescription,
    // The session's own card from scripts/build-session-cards.mjs, so a talk
    // pasted into a channel unfurls under its own title. Two formats of the
    // one image, which base.njk offers a crawler as alternates. A session
    // without a card falls back to the site-wide one in both formats, which is
    // the normal state on a checkout that has never run the generator and no
    // more an error than a speaker without a photo.
    shareImage: (data) => data.session.shareCard?.url,
    shareImageWebp: (data) => data.session.shareCard?.webp,
    shareImageAlt: (data) =>
      data.session.shareCard &&
      `Mørkeblå plakat med JavaZone-logoen og teksten «${data.session.title}», ` +
        `${data.session.shareFacts.day} ${data.session.shareFacts.time}, ` +
        `${data.session.shareFacts.room}.`,
    back: (data) => `${data.session.day.url}#session-${data.session.id}`,
  },
};
