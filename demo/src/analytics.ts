import { Analytics } from "../../analytics/core/api/analytics";
import { startAutoTrack } from "../../analytics/adapters/browser/auto-track";

/**
 * Composition root for the demo.
 *
 * The SDK is created here and the browser probes are
 * registered explicitly: core never constructs an
 * adapter itself.
 *
 * Imports point at the concrete modules, not the package
 * barrel: the barrel pulls in the jQuery adapter, which
 * drags @types/jquery into every consumer.
 */
export const analytics = new Analytics({
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

analytics.registerTracker(
  startAutoTrack(analytics, {
    page: true,
    click: true,
    api: true,
  }),
);

// Handy for poking around in the console.
(window as unknown as Record<string, unknown>).analytics =
  analytics;
