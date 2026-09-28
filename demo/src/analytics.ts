import { Analytics } from "../../analytics/core/api/analytics";
import { ClickTracker } from "../../analytics/adapters/browser/click-tracker";
import { PageTracker } from "../../analytics/adapters/browser/page-tracker";
import { FetchTracker } from "../../analytics/adapters/browser/fetch-tracker";

/**
 * Composition root for the demo.
 *
 * The SDK no longer auto-detects or auto-installs probes: every
 * tracker is constructed, started and registered by hand. That
 * makes the wiring explicit and leaves the set of active probes
 * exactly what is listed below.
 */
const analytics = new Analytics({
  endpoint: "/api/analytics/events",

  // Small values so batching is visible while clicking.
  batchSize: 5,
  flushInterval: 2000,

  debug: {
    enabled: true,
    console: true,
    inspector: true,
  },
});

const page = new PageTracker(analytics);
const click = new ClickTracker(analytics);
const fetch = new FetchTracker(analytics);

page.start();
click.start();
fetch.start();

analytics.registerTracker(page);
analytics.registerTracker(click);
analytics.registerTracker(fetch);

// Also sets window.analytics for console poking.
(globalThis as Record<string, unknown>)["analytics"] = analytics;

export { analytics };
