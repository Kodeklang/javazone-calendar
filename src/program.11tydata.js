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
    // The abstract's opening, not the title: the session's own share card
    // already shows the title, day, time and room, so an unfurler that
    // renders only the title line would repeat the picture rather than add
    // to it - see site.js's `shareTitle` for the truncation budget and the
    // no-abstract fallback.
    shareTitle: (data) => data.session.shareTitle,
    // Day, time, room and speaker ahead of the abstract - see site.js's
    // `shareDescription` for why a share card wants the facts first.
    shareDescription: (data) => data.session.shareDescription,
    // The session's own card from scripts/build-session-cards.mjs, so a talk
    // pasted into a channel unfurls under its own title. A session without a
    // card falls back to the site-wide one, which is the normal state on a
    // checkout that has never run the generator and no more an error than a
    // speaker without a photo.
    shareImage: (data) => data.session.shareCard?.url,
    // The card, in the order a viewer reads it: the mark, the title, the
    // speakers with their photo or their monogram, and the facts along the
    // bottom. The speakers are in here because they are on the card now - a
    // description that stopped at the title would be describing the card this
    // site drew last month. `speakerList` does the Norwegian join (site.js), a
    // session without one says nothing rather than leaving an empty clause.
    shareImageAlt: (data) =>
      data.session.shareCard &&
      `Mørkeblå plakat med JavaZone-logoen, teksten «${data.session.title}»` +
        (data.session.speakerList
          ? `, ${data.session.speakers.length > 1 ? "foredragsholderne" : "foredragsholderen"} ` +
            `${data.session.speakerList}`
          : "") +
        `, ${data.session.shareFacts.day} ${data.session.shareFacts.time}, ` +
        `${data.session.shareFacts.room}.`,
    back: (data) => `${data.session.day.url}#session-${data.session.id}`,
  },
};
