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
const analytics = new Analytics({
  endpoint: "/api/analytics/events",

  // Small values so batching is visible while clicking.
  batchSize: 5,
  flushInterval: 2000,

  debug: {
    enabled: true,
    console: true,
  },

  probes: [
    recorder => new PageTracker(recorder),
    recorder => new ClickTracker(recorder),
  ],
});

analytics.start();

// Also sets window.analytics for console poking.
(globalThis as Record<string, unknown>)["analytics"] = analytics;

export { analytics };
