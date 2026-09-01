// Starts Real User Monitoring, and carries the build-time configuration in
// src/_data/rum.js into the browser: src/js/app.js is copied through untouched
// and never sees a template.
//
// The SDK is 143KB of JavaScript on a page whose own script is 10KB, so it is
// not allowed near the critical path. A deferred <script> in the head would
// mean every visitor downloaded and ran it before the document was
// interactive; this file pulls it in once the browser is idle instead.
//
// RUM still reports the page load itself: the SDK reads the Navigation Timing
// entries retrospectively rather than having to be present while they happen.

const SDK = "/js/datadog/datadog-rum-slim.js";
const CONFIG = {
  "applicationId": "ccc2ef8b-f479-448b-b099-fb05bec4dbb1",
  "clientToken": "pubdb51dce078321c0855b9964fb21ba4dd",
  "site": "datadoghq.eu",
  "service": "javazone-calendar",
  "env": "prod",
  "version": "1.0.0",
  "sessionSampleRate": 100,
  "trackResources": true,
  "trackUserInteractions": true,
  "trackLongTasks": true
};

function start() {
  // A content blocker eating the bundle must never take the programme down.
  if (!window.DD_RUM) return;
  window.DD_RUM.onReady(function () {
    window.DD_RUM.init(CONFIG);
  });
}

function loadSdk() {
  const script = document.createElement("script");
  script.src = SDK;
  script.async = true;
  script.addEventListener("load", start);
  document.head.appendChild(script);
}

// Idle time only arrives once the browser has finished the work that matters;
// the timeout is the backstop for a page that never goes idle. Safari has no
// requestIdleCallback, so it waits a beat instead.
if (window.requestIdleCallback) requestIdleCallback(loadSdk, { timeout: 3000 });
else setTimeout(loadSdk, 1200);
