import { Analytics } from "../../analytics/core/api/analytics";

/**
 * One SDK instance shared by every demo page.
 *
 * Imports point at the concrete module, not the package
 * barrel: the barrel pulls in the jQuery adapter, which
 * drags @types/jquery into every consumer.
 */
export const analytics = new Analytics({
  endpoint: "/api/analytics/events",

  // Small values so batching is visible while clicking.
  batchSize: 5,
  flushInterval: 2000,

  autoTrack: {
    page: true,
    click: true,
    api: true,
  },

  debug: {
    enabled: true,
    console: true,
    inspector: true,
  },
});

// Handy for poking around in the console.
(window as unknown as Record<string, unknown>).analytics =
  analytics;
