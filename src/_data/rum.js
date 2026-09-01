// Real User Monitoring settings, passed verbatim to datadogRum.init() by
// rum.njk. This lives apart from site.js because none of it derives from the
// programme: it is deployment metadata, and site.js is strictly a view model.
//
// The application id and client token are public by design. Datadog's browser
// tokens are write-only intake credentials meant to be shipped to every
// visitor; they grant no read access to the organisation.

import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

export default {
  applicationId: "ccc2ef8b-f479-448b-b099-fb05bec4dbb1",
  clientToken: "pubdb51dce078321c0855b9964fb21ba4dd",
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
