import { Analytics } from "../../analytics/core/api/analytics";
import { ClickTracker } from "../../analytics/core/probes/click-tracker";
import { PageTracker } from "../../analytics/core/probes/page-tracker";

/**
 * Composition root for the demo.
 *
 * The SDK has no auto-detection and no probe registry: the two
 * probes are named here, as factories. A factory rather than a
 * class because a probe needs the recorder in its constructor
 * and the recorder is the object being constructed — which also
 * means options still reach the probe.
 *
 * Nothing starts here. `probes` says *what* is wired; `start()`
 * below is still what says *when* it runs.
 */

// The correlation id belongs to the host. The SDK only reads it,
// from `sessionStorage["analytics.session"]`, and reports null
// when nothing is there — so here is the host half of that
// contract. In a real app this is wherever the backend's id
// arrives: a login response, a bootstrap payload, a cookie the
// app already parsed.
//
// Flip this to see the field populated; the mock server's log
// line prints whichever the case is. Left `false` because the
// demo has no real session, and writing a fabricated id would
// make the log look like the SDK still mints one.
const HOST_WRITES_CORRELATION_ID = false;

if (HOST_WRITES_CORRELATION_ID) {
  globalThis.sessionStorage.setItem(
    "analytics.session",
    `demo-${Date.now().toString(36)}`,
  );
} else {
  globalThis.sessionStorage.removeItem("analytics.session");
}

const analytics = new Analytics({
  endpoint: "/api/analytics/events",

  // Small values so batching is visible while clicking.
  batchSize: 5,
  flushInterval: 2000,

  // One boolean: the console is the only sink, so there is
  // nothing a second field could decide.
  debug: true,

  probes: [
    recorder => new PageTracker(recorder),
    recorder => new ClickTracker(recorder),
  ],
});

analytics.start();

// Also sets window.analytics for console poking.
(globalThis as Record<string, unknown>)["analytics"] = analytics;

export { analytics };
