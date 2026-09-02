// Service worker for the JavaZone programme.
//
// The whole site is taken on the way in: every day grid, every talk, the
// subset fonts. It buys a programme that works in a hall with no signal at
// all - including talks the visitor never happened to open while they still
// had it.
//
// The shell is cached at install and the rest once this worker is in charge,
// because activation is what carries an update to a page that is already open.
//
// The cache name carries a hash of the programme *and* every shipped asset, so
// any real change retires the old cache wholesale.

const CACHE = "jz-1a86e93b770b";

const BASE = "/";

// What the app cannot run without. This list is taken atomically: if any of it
// cannot be had, the install fails and the old worker stays in charge, which is
// better than activating a cache that is missing the stylesheet.
//
// Day one's url *is* BASE, so the loop already covers the front page. Listing
// it twice would make cache.addAll reject the whole install on duplicates.
const SHELL = [
  "/",
  "/dag/2/",
  "/dag/3/",
  "/css/style.css?v=1a86e93b770b",
  "/css/fonts.css?v=1a86e93b770b",
  "/js/app.js?v=1a86e93b770b",
  "/js/rum.js?v=1a86e93b770b",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
];

// Everything else the site publishes.
const REST = [...new Set([
  // The detail pages: the whole point of precaching this much.
  "/program/write-once-run-anywhere-a-hands-on-compose-multiplatform-wor-b887eba1/",
  "/program/cloud-on-your-terms-building-your-own-cloud-native-platform-d79dfb8b/",
  "/program/create-your-own-role-playing-game-with-agentic-ai-using-spri-2aaaecf1/",
  "/program/red-light-green-light-997f247a/",
  "/program/building-secure-ai-agents-with-quarkus-langchain4j-7209dd07/",
  "/program/from-streams-to-sql-to-ai-build-an-open-source-htap-platform-03b4350b/",
  "/program/pleesah-laer-meg-mer-om-kubernetes-4bbb28c1/",
  "/program/ai-can-t-debug-this-a-virtual-thread-migration-workshop-8ea8a4f0/",
  "/program/bygg-riktig-for-du-bygger-ferdig-tjenestedesign-for-utvikler-b2560309/",
  "/program/event-sourcing-from-chaos-to-control-0a721b50/",
  "/program/build-ai-agents-that-actually-do-things-hands-on-with-mcp-46ed44c5/",
  "/program/from-data-to-ogc-api-features-service-using-geoserver-4685a83a/",
  "/program/50-tips-pa-60-min-bli-bedre-med-ai-agenter-bf1d8198/",
  "/program/talking-to-machines-the-history-and-future-of-programming-la-f8eac465/",
  "/program/fra-spagetti-til-legoklosser-modularisert-arkitektur-og-tdd--e03d6415/",
  "/program/building-for-the-world-one-iteration-at-a-time-d48337af/",
  "/program/async-is-the-new-goto-rethinking-structured-concurrency-d01d734f/",
  "/program/da-pappa-delte-snuskete-innhold-pa-facebook-en-liten-histori-1e4eb325/",
  "/program/slas-slos-and-slis-demystifying-sre-9ab58dfe/",
  "/program/bearer-of-good-news-b5aa1e6d/",
  "/program/47-000-millionaerer-d17ba5e3/",
  "/program/git-t-h-ree-d0056694/",
  "/program/the-positive-value-of-negative-space-d8028049/",
  "/program/let-s-break-some-wcag-rules-5ba26d74/",
  "/program/fremtidens-applikasjoner-lages-for-maskiner-b20063ea/",
  "/program/leveransekjedesikkerhet-i-praksis-34dc522e/",
  "/program/sanntidsinformasjon-i-saksbehandlingssystemer-074fa6da/",
  "/program/microsoft-monoculture-the-lock-in-nobody-talks-about-666922ab/",
  "/program/self-healing-rollouts-automating-production-fixes-with-agent-e7a9e513/",
  "/program/immutable-linux-the-future-of-the-desktop-0b189feb/",
  "/program/how-do-we-version-software-e18fa8f1/",
  "/program/kotlin-extension-functions-en-advarsel-fra-skyttergravene-c1b449a3/",
  "/program/from-kotlin-to-java-walk-in-the-park-or-stepping-on-lego-47a1c9cb/",
  "/program/bootiful-spring-boot-4-29c54f57/",
  "/program/let-s-create-a-tiny-llm-library-together-2b2b442c/",
  "/program/my-year-with-claude-building-midimeria-music-production-anal-a5c53c7d/",
  "/program/talk-to-me-java-299ff47c/",
  "/program/what-rscs-can-do-in-next-js-today-216a87ee/",
  "/program/sunset-as-a-service-nar-malet-er-eol-8412a465/",
  "/program/the-best-way-to-fetch-multi-level-hierarchies-from-a-rdbms-u-79f3959a/",
  "/program/the-1-problem-an-introduction-to-ai-security-a9fa06ab/",
  "/program/conways-lov-i-praksis-f420976d/",
  "/program/metodikk-som-tvangstroye-95b54065/",
  "/program/en-bedre-maven-authentication-f82134e5/",
  "/program/java-patterns-why-how-and-when-not-6092efef/",
  "/program/from-data-engineering-to-knowledge-engineering-in-the-blink--56bb956d/",
  "/program/quantum-ready-java-a-practical-guide-to-post-quantum-cryptog-1e8c933f/",
  "/program/the-magic-of-opentelemetry-rewriting-your-app-in-production-b76bd602/",
  "/program/norsk-forskning-hva-gjor-norske-organisasjoner-med-agentisk--17861e6b/",
  "/program/passkeys-enklere-enn-du-tror-slik-implementerer-du-stotte-fo-cb6bd929/",
  "/program/no-more-magic-mastering-the-explicit-kotlin-stack-with-ktor--4443a9a9/",
  "/program/fra-plastkort-til-protokoller-deling-av-data-fra-eu-si-digit-ad6c7094/",
  "/program/knowing-without-knowing-2991d2ac/",
  "/program/how-to-keep-secrets-from-your-agent-c14b5db1/",
  "/program/a-skifte-vinger-i-lufta-eller-hjul-mens-sykkelen-er-i-nedove-02dd2bd6/",
  "/program/hexagonal-happiness-b655f6d1/",
  "/program/no-more-forks-policy-transformation-for-terraform-at-scale-85f27d93/",
  "/program/global-cultural-reflections-on-software-testing-practices-1234300a/",
  "/program/your-database-sprawl-is-a-1990s-workaround-give-it-a-kiss-9ae57287/",
  "/program/nyheter-i-javascript-es2026-efcc1030/",
  "/program/managing-the-chaos-automating-internal-dependency-upgrades-w-66e04b5d/",
  "/program/gentle-introduction-to-lock-free-programming-in-java-5a6c19a4/",
  "/program/korleis-me-gjekk-fra-react-til-css-hos-designsystemet-538d7a0d/",
  "/program/fa-oversikt-over-json-med-jsonata-sporringer-d8c89901/",
  "/program/stop-writing-api-clients-let-the-spec-do-it-4c36ab23/",
  "/program/hvordan-logger-kan-felle-en-nav-direktor-5618fc48/",
  "/program/building-intelligent-java-apps-agent-patterns-mcp-and-the-fu-1a6f75e1/",
  "/program/the-lightweight-approach-to-building-internal-developer-plat-39113b56/",
  "/program/when-orm-becomes-omg-performance-pitfalls-in-jpa-and-friends-9f6ab2c0/",
  "/program/personalizing-your-random-numbers-0b705889/",
  "/program/hvorfor-du-bor-ha-timeout-i-regex-en-din-ea3ebf75/",
  "/program/10-things-i-hate-about-java-58719c5f/",
  "/program/the-bold-the-broken-and-the-burned-hard-won-lessons-in-the-7-03e100e1/",
  "/program/nar-regresjonen-blir-automatisert-hvor-skaper-testeren-mest--eec6205c/",
  "/program/spec-test-doc-one-table-three-lives-d9cad1b0/",
  "/program/rust-will-slash-your-backend-costs-1c2fbbbd/",
  "/program/dream-machines-walled-gardens-85e7fd3d/",
  "/program/bra-tools-ubrukelige-svar-laering-fra-ett-ar-med-mcp-1f42fc0f/",
  "/program/building-production-ready-kubernetes-operators-a-practical-g-dc826b82/",
  "/program/architecture-under-fire-the-decisions-nobody-tells-you-about-cfa314bb/",
  "/program/simd-for-java-how-elasticsearch-already-benefits-from-the-pa-77531d92/",
  "/program/bare-spor-ai-agenter-elsker-produksjonsmetrikker-691ca67c/",
  "/program/let-s-use-spring-boot-to-build-games-because-why-not-ddf116cb/",
  "/program/demoscene-coding-kickstart-6e209473/",
  "/program/de-usette-langtidskostnadene-med-dagens-ki-1f73fe75/",
  "/program/ai-is-easy-trustworthy-data-is-hard-why-data-engineers-matte-90e838e0/",
  "/program/hacking-i-gamle-dager-roverhistorier-fra-80-og-90-tallet-1c43a5a8/",
  "/program/snake-in-10-lines-learning-more-by-coding-less-9121cedf/",
  "/program/how-are-we-doing-practical-metrics-that-matter-915f17a8/",
  "/program/secure-by-inclusion-preventing-accessibility-barriers-from-b-c0e27e22/",
  "/program/let-s-dance-teaching-your-robot-some-moves-with-reinforcemen-fb9f67e1/",
  "/program/hardwood-building-a-parquet-parser-from-scratch-with-a-littl-268b3ef0/",
  "/program/er-laering-framleis-relevant-8396416a/",
  "/program/crafting-the-ultimate-docker-image-for-spring-applications-71018b64/",
  "/program/optimizing-self-driving-vehicles-and-bus-operations-where-do-0712916b/",
  "/program/modern-java-in-the-age-of-ai-81600832/",
  "/program/nar-verktoyet-er-meir-enn-halve-jobben-korleis-opensource-ap-facbebdd/",
  "/program/apis-secrets-and-lies-the-messy-reality-of-zero-trust-at-sca-a5811e7d/",
  "/program/event-sourcing-the-only-sane-way-to-run-agentic-systems-13fb6b2e/",
  "/program/kom-i-gang-med-mobbprogrammering-c60f9413/",
  "/program/hvordan-vi-temmer-en-domenemodell-med-1500-klasser-74caf7d7/",
  "/program/getting-more-out-of-maven-eb71fbbf/",
  "/program/35-minutes-ago-you-had-20-seconds-to-comply-a-survival-guide-b47b63d7/",
  "/program/feature-management-beyond-feature-flags-850d3f1f/",
  "/program/brukollapsen-som-bygde-en-bro-mellom-fag-og-it-11b26a0a/",
  "/program/trust-but-verify-skill-driven-development-for-the-sceptical--7ba94a91/",
  "/program/tilgjengelighet-utvikling-true-4f334bb4/",
  "/program/flyt-i-ai-ens-tid-nar-det-blir-lettere-a-lage-men-vanskelige-1d782b1f/",
  "/program/the-decision-layer-context-graphs-for-spring-ai-71a26d1c/",
  "/program/rendering-3d-shadows-in-the-browser-with-three-js-16bc011e/",
  "/program/angsten-din-gir-mening-men-du-ma-ga-videre-i-livet-eae22700/",
  "/program/heis-fm-live-5381f76e/",
  "/program/cassandra-compaction-allocation-free-and-5x-faster-279920c0/",
  "/program/gleam-and-beam-looking-beyond-the-jvm-861a5d27/",
  "/program/erstatningssystemfella-595f85e2/",
  "/program/the-right-300-tokens-beat-100k-noisy-ones-four-context-antip-36db26e6/",
  "/program/gar-det-ingen-tog-c2323ef1/",
  "/program/cra-security-deadlines-loom-what-senior-java-engineers-must--b94735b6/",
  "/program/jdk8-to-25-without-the-pain-engineering-a-modern-java-platfo-b65533ef/",
  "/program/nar-noen-tar-ansvar-c5f591a7/",
  "/program/hva-skjedde-da-ai-kom-til-glow-c7593811/",
  "/program/a-brief-history-of-artificial-intelligence-2d2ac51a/",
  "/program/modules-didn-t-fail-build-tools-did-04e70aaa/",
  "/program/we-re-making-this-a-lot-harder-than-it-needs-to-be-ac8124ed/",
  "/program/you-don-t-need-a-frontend-you-just-need-kotlin-b2d2398f/",
  "/program/steinras-flom-og-it-systemer-fra-90-tallet-it-utvikling-nar--0942b877/",
  "/program/ehf-fakturaen-din-har-reist-verden-rundt-visste-du-det-291c9092/",
  "/program/an-opinionated-guide-to-bulletproof-apis-with-java-e0fc50a6/",
  "/program/fra-123-entusiastiske-brukere-daglig-til-3-7-millioner-norge-3d14ed40/",
  "/program/egendriftet-paas-for-under-100-kr-i-maneden-106f5ae6/",
  "/program/your-service-layer-is-a-mess-here-s-a-simple-fix-6f24def7/",
  "/program/the-ai-puppet-dance-2b23d759/",
  "/program/digipost-om-ux-i-norges-nye-virksomhetslommebok-5e04257b/",
  "/program/a-practical-guide-to-european-public-cloud-providers-95687d0d/",
  "/program/sikkerhet-fra-mangfold-38a08a7a/",
  "/program/domain-driven-web-apis-89812007/",
  "/program/package-by-sub-domain-eea988e1/",
  "/program/concurrency-testing-on-the-jvm-d8267b0c/",
  "/program/you-re-absolutely-right-it-was-your-home-directory-e92e66b5/",
  "/program/debugging-class-loading-with-gdb-67603505/",
  "/program/modern-packaging-and-installation-of-java-applications-from--9f0e7cbf/",
  "/program/understanding-prompt-injection-techniques-challenges-and-adv-cf189c38/",
  "/program/kodearkeologer-pa-legacy-eventyr-7a7da44d/",
  "/program/spring-spock-vs-kotest-vs-junit-when-to-pick-which-one-d6ad9cb7/",
  "/program/stop-writing-terraform-build-developer-friendly-platforms-wi-2fb685db/",
  "/program/retro-meets-ai-shipping-games-across-40-years-of-tech-02b863d3/",
  "/program/kotlin-coroutines-in-ktor-what-you-need-to-know-78314dc8/",
  "/program/a-journey-on-tour-with-java-code-on-it-s-way-through-the-jvm-08b03b16/",
  "/program/how-to-git-away-with-murder-d4eb6460/",
  "/program/generics-you-never-know-what-you-re-gonna-get-84c0346e/",
  "/program/reproducible-environments-why-docker-isn-t-enough-and-why-ni-3db5bd92/",
  "/program/the-sound-of-privacy-what-your-spotify-data-reveals-about-yo-a60438e6/",
  "/program/shader-sorcery-summon-surreal-scenery-471359a7/",
  "/program/how-i-built-my-own-intelligent-robot-arm-from-scratch-f0aeaff3/",
  "/program/understanding-buildpacks-delving-deep-into-their-functionali-e3105780/",
  // fonts.css is in the shell; the faces it names are not, because
  // font-display: swap means a missing one costs typography and not the page.
  "/css/fonts/montserrat-400-latin-ext.woff2",
  "/css/fonts/montserrat-400-latin.woff2",
  "/css/fonts/montserrat-400i-latin-ext.woff2",
  "/css/fonts/montserrat-400i-latin.woff2",
  "/css/fonts/montserrat-500-latin-ext.woff2",
  "/css/fonts/montserrat-500-latin.woff2",
  "/css/fonts/montserrat-600-latin-ext.woff2",
  "/css/fonts/montserrat-600-latin.woff2",
  "/css/fonts/montserrat-700-latin-ext.woff2",
  "/css/fonts/montserrat-700-latin.woff2",
  "/css/fonts/montserrat-800-latin-ext.woff2",
  "/css/fonts/montserrat-800-latin.woff2",
  // Speaker photos. In REST rather than SHELL: they are ~250 kB in total and
  // an install must not fail over one of them, but they do have to be here -
  // a card whose img is chosen at build time has no monogram to fall back to,
  // so an uncached photo is a broken image in the hall rather than initials.
  // The ?v matches the src in program.njk exactly; a precache entry that does
  // not match the request it is meant to answer is dead weight.
  "/photos/morten-nygaard-asnes.webp?v=1a86e93b770b",
  "/photos/kristian-berg.webp?v=1a86e93b770b",
  "/photos/hans-kristian-flaatten.webp?v=1a86e93b770b",
  "/photos/radek-kargul.webp?v=1a86e93b770b",
  "/photos/willem-jan-glerum.webp?v=1a86e93b770b",
  "/photos/a-n-m-bazlur-rahman.webp?v=1a86e93b770b",
  "/photos/piotr-laskawiec.webp?v=1a86e93b770b",
  "/photos/ken-sipe.webp?v=1a86e93b770b",
  "/photos/sam-bellen.webp?v=1a86e93b770b",
  "/photos/christin-gorman.webp?v=1a86e93b770b",
  "/photos/elise-kristiansen.webp?v=1a86e93b770b",
  "/photos/knut-haugen.webp?v=1a86e93b770b",
  "/photos/kevin-dubois.webp?v=1a86e93b770b",
  "/photos/oystein-hagen-blixhavn.webp?v=1a86e93b770b",
  "/photos/josh-long.webp?v=1a86e93b770b",
  "/photos/johannes-bechberger.webp?v=1a86e93b770b",
  "/photos/martin-skarsaune.webp?v=1a86e93b770b",
  "/photos/aurora-scharff.webp?v=1a86e93b770b",
  "/photos/nadia-tokerud.webp?v=1a86e93b770b",
  "/photos/cay-horstmann.webp?v=1a86e93b770b",
  "/photos/veronika-heimsbakk.webp?v=1a86e93b770b",
  "/photos/akihiro-nishikawa.webp?v=1a86e93b770b",
  "/photos/bruce-bujon.webp?v=1a86e93b770b",
  "/photos/nikolai-norman-andersen.webp?v=1a86e93b770b",
  "/photos/johannes-brodwall.webp?v=1a86e93b770b",
  "/photos/mick-semb-wever.webp?v=1a86e93b770b",
  "/photos/gaute-meek-olsen.webp?v=1a86e93b770b",
  "/photos/jago-de-vreede.webp?v=1a86e93b770b",
  "/photos/daniel-oh.webp?v=1a86e93b770b",
  "/photos/adele-carpenter.webp?v=1a86e93b770b",
  "/photos/anders-noras.webp?v=1a86e93b770b",
  "/photos/piotr-przybyl.webp?v=1a86e93b770b",
  "/photos/anders-sveen.webp?v=1a86e93b770b",
  "/photos/alexander-chatzizacharias.webp?v=1a86e93b770b",
  "/photos/gunnar-morling.webp?v=1a86e93b770b",
  "/photos/pasha-finkelshteyn.webp?v=1a86e93b770b",
  "/photos/georges-saab.webp?v=1a86e93b770b",
  "/photos/marit-van-dijk.webp?v=1a86e93b770b",
  "/photos/andres-almiray.webp?v=1a86e93b770b",
  "/photos/totto-thor-henning-hetland.webp?v=1a86e93b770b",
  "/photos/fredrik-lillemoen-eiding.webp?v=1a86e93b770b",
  "/photos/baruch-sadogursky.webp?v=1a86e93b770b",
  "/photos/ixchel-ruiz.webp?v=1a86e93b770b",
  "/photos/morten-andersen-gott.webp?v=1a86e93b770b",
  "/photos/tim-berglund.webp?v=1a86e93b770b",
  "/photos/rafael-winterhalter.webp?v=1a86e93b770b",
  "/photos/rustam-mehmandarov.webp?v=1a86e93b770b",
  "/photos/einar-waaler-host.webp?v=1a86e93b770b",
  "/photos/adam-warski.webp?v=1a86e93b770b",
  "/photos/oleg-selajev.webp?v=1a86e93b770b",
  "/photos/brian-vermeer.webp?v=1a86e93b770b",
  "/photos/gerrit-grunwald.webp?v=1a86e93b770b",
  "/photos/bram-janssens.webp?v=1a86e93b770b",
  "/photos/leonard-sheng-sheng-lee.webp?v=1a86e93b770b",
  "/photos/marten-range.webp?v=1a86e93b770b",
  "/photos/patrick-baumgartner.webp?v=1a86e93b770b",
  // Only ever fetched by an install prompt or the home screen, so they would
  // otherwise be the assets least likely to be cached when they are needed.
  "/icons/icon-180.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/js/datadog/datadog-rum-slim.js",
])];

// cache: "reload" so the precache is filled from the network rather than from
// the browser's HTTP cache. GitHub Pages stamps every asset max-age=600, so a
// worker installing in the ten minutes after a deploy would otherwise store
// pre-deploy files under a cache name asserting they are current - and nothing
// below ever revalidates them.
const fromNetwork = (url) => new Request(url, { cache: "reload" });

/**
 * Fill the cache with everything in REST.
 *
 * Deliberately not cache.addAll: that is all-or-nothing, which is the right
 * trade for ten shell files and the wrong one for a hundred and seventy. A
 * single page 404ing must not cost the visitor every other cached page.
 * Whatever is missed here still resolves through the fetch handler on first
 * use.
 *
 * The requests go out a few at a time rather than all at once, because this
 * runs while the visitor is reading the page that triggered it - on a crowded
 * conference network, a hundred and seventy parallel fetches would be taken out
 * of the bandwidth they are currently browsing on.
 *
 * Already-stored entries are skipped, so a pass that was cut short - the
 * browser is free to kill a worker mid-task - resumes where it stopped instead
 * of fetching the programme again.
 */
const missing = new Set();
async function warm(cache) {
  let next = 0;
  const worker = async () => {
    while (next < REST.length) {
      const url = REST[next++];
      // A 404 is remembered for the life of this worker instance, so a page
      // the programme no longer has is not asked for again on every visit.
      if (missing.has(url) || await cache.match(url)) continue;
      try {
        const response = await fetch(fromNetwork(url));
        if (response.ok) await cache.put(url, response);
        else missing.add(url);
      } catch {
        /* offline mid-warm: the fetch handler will pick this one up later */
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

// One pass at a time. Every navigation asks for the programme to be topped up,
// and without this each would start a competing pass over the same files.
//
// Never passed to waitUntil, and that is the most important line in this file.
// A waiting worker may only activate once the active one has no pending
// events, skipWaiting or not - that is in the specification, and Safari holds
// to it. With a multi-megabyte warm extending every navigation, and iOS killing
// the worker partway through, the active worker is left looking permanently
// busy: every deploy's worker installs, goes to "waiting", and stays there for
// hours, with the visitor on the build from before. Left to run on its own the
// warm still does its job - a killed worker resumes where it stopped the next
// time it is woken - and it no longer stands between an update and the visitor.
let warming = null;
function warmOnce() {
  warming ??= caches.open(CACHE)
    .then(warm)
    .finally(() => { warming = null; });
  return warming;
}

self.addEventListener("install", (event) => {
  // The shell only. The rest of the programme is fetched after this worker is
  // in charge, deliberately: an install that has to pull everything first is an
  // update the visitor cannot see for as long as it takes. The banner would sit
  // there through every reload, because until this worker activates the old one
  // keeps answering with the page it already had.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(fromNetwork));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    // Claiming is what reloads a page sitting on the previous version.
    await self.clients.claim();
  })());
  // Outside waitUntil, see warmOnce. It also keeps activation instant: a fetch
  // is held back until the worker is activated, so a page must not have to
  // wait for the whole programme to come down before it can be served.
  warmOnce();
});

/**
 * Serve the page from the cache and refresh it in the background.
 *
 * Every page is precached, so moving around the programme costs a cache read
 * rather than a round trip - which on a crowded conference network is the
 * difference between instant and a wait. Going to the network first meant
 * waiting for it even though the answer was already on disk.
 *
 * Freshness does not depend on this path. A deploy changes CACHE, so the new
 * worker installs a fresh copy of every page and app.js reloads the document on
 * controllerchange; version.json is never served from here, so the poll that
 * asks for that worker still sees the truth.
 */
async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  // fromNetwork, for the same reason the precache uses it, and this is the
  // one place it was missed. GitHub Pages stamps every page max-age=600, so a
  // plain fetch in the ten minutes after a deploy is answered from the
  // browser's HTTP cache with the very bytes this is trying to replace - and
  // then stores them under a cache name asserting they are the new build.
  // warm() skips entries that are already present, so nothing ever corrects
  // one: the page stays on the old build until someone presses reload on that
  // exact page. That is what made a layout change take a click per page.
  //
  // Navigation preload is gone with it. Its response comes off the same HTTP
  // cache and cannot be asked for anything else, so it can only reintroduce
  // the problem - and with every page precached it was answering a request
  // that almost never reached the network anyway.
  const fresh = (async () => {
    const response = await fetch(fromNetwork(request));
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })();

  if (cached) {
    // Do not make the visitor wait on the refresh, but keep the worker alive
    // long enough to finish it.
    event.waitUntil(fresh.catch(() => {}));
    return cached;
  }

  try {
    return await fresh;
  } catch {
    return (await cache.match(BASE)) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  // Same reason as the precache: a miss is about to be stored under a cache
  // name that stands for a particular deploy, so it must come from the network
  // and not from whatever the HTTP cache kept from the last one.
  const response = await fetch(fromNetwork(request));
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // The update check must always see the truth.
  if (url.pathname === `${BASE}version.json`) return;

  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(event, request));
    // Top up anything a killed worker left behind, so the offline guarantee
    // repairs itself rather than waiting for the next deploy. Not awaited and
    // not extending the event, see warmOnce.
    warmOnce();
    return;
  }

  // A request that asks to bypass caches means it. The update button fetches
  // the current page this way, and a fetch() is not a navigation - without
  // this it was answered from the cache with the very page it was trying to
  // replace, and the reload that followed showed it again.
  if (request.cache === "reload" || request.cache === "no-store") {
    event.respondWith(fetch(request));
    return;
  }

  // Fonts, icons, CSS and JS are all retired by the cache name.
  event.respondWith(cacheFirst(request));
});
