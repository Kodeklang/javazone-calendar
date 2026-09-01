// Real User Monitoring settings, passed verbatim to datadogRum.init() by
// rum.njk. This lives apart from site.js because none of it derives from the
// programme: it is deployment metadata, and site.js is strictly a view model.
//
// The application id and client token are public by design. Datadog's browser
// tokens are write-only intake credentials meant to be shipped to every
// visitor; they grant no read access to the organisation.
//
// TODO: replace both with the real values for this application in Datadog.
// Until then RUM initialises against an id that does not exist and its intake
// requests are rejected, which costs nothing but collects nothing either.

import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

export default {
  applicationId: "00000000-0000-0000-0000-000000000000",
  clientToken: "pubreplaceme00000000000000000000",
  site: "datadoghq.eu",
  service: "javazone-calendar",

  // GitHub Actions is the only thing that publishes, so anything else is a
  // developer running `eleventy --serve` and must not land in production data.
  env: process.env.CI ? "prod" : "dev",
  // Deliberately not site.version: that is a hash of the programme, which the
  // hourly fetch changes for reasons that have nothing to do with the code.
  version: pkg.version,

  sessionSampleRate: 100,
  trackResources: true,
  trackUserInteractions: true,
  trackLongTasks: true,

  // No sessionReplaySampleRate or defaultPrivacyLevel: both only govern the
  // session replay recorder, which the slim build does not carry.
};
