import { init } from "../../analytics/adapters";

/**
 * Composition root for the demo.
 *
 * One call: `init()` creates the SDK, starts the browser
 * probes and registers every network adapter the current
 * runtime supports. Calling it twice returns the same
 * instance, so a second entry point cannot double events.
 *
 * Imports the adapter entry directly, not the package
 * barrel — the barrel is for published packages with
 * subpath exports, this demo builds from source.
 */
export const analytics = init({
  endpoint: "/api/analytics/events",

  // Small values so batching is visible while clicking.
  batchSize: 5,
  flushInterval: 2000,

  autoTrack: {
    page: true,
    click: true,
  },

  network: {
    fetch: true,
  },

  debug: {
    enabled: true,
    console: true,
    inspector: true,
  },

  // Also sets window.analytics for console poking.
  globalName: "analytics",
});
