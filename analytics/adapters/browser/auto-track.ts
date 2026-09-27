import { Analytics } from "../../core/api/analytics";
import type { AnalyticsConfig } from "../../core/api/config";
import type { EventRecorder, Tracker } from "../../core/api/tracker";
import { ClickTracker } from "./click-tracker";
import { PageTracker } from "./page-tracker";

/**
 * Which DOM probes to wire.
 *
 * Network tracking is deliberately absent: it is a second,
 * overlapping switch (`network.fetch` / `frameworks.*`) that
 * `init()` and `registerDetectedAdapters()` own. Having both
 * meant `startAutoTrack({ api: true })` could install a fetch
 * probe behind the composition root's back, with no record of
 * it in `InstallState`.
 */
export interface AutoTrackOptions {
  page?: boolean;
  click?: boolean;
}

/**
 * Composition helper: build the default browser probes
 * and start them against a recorder.
 *
 * Who starts a tracker is decided here, not inside core.
 */
export function startAutoTrack(
  recorder: EventRecorder,
  options: AutoTrackOptions = {},
): Tracker {

  const trackers: Tracker[] = [];

  if (options.page ?? true) {
    trackers.push(new PageTracker(recorder));
  }

  if (options.click ?? true) {
    trackers.push(new ClickTracker(recorder));
  }

  trackers.forEach(tracker => tracker.start());

  return {
    start: () => trackers.forEach(t => t.start()),
    stop: () => trackers.forEach(t => t.stop()),
  };

}

export interface BrowserAnalyticsConfig
  extends AnalyticsConfig {
  /**
   * Deprecated shim: `autoTrack` used to live on
   * AnalyticsConfig. It is handled here, in the adapter
   * layer, so core stays free of adapter knowledge.
   */
  autoTrack?: AutoTrackOptions;
}

/**
 * Composition root in a box: creates the SDK and wires
 * the browser probes. Keeps `new Analytics({ autoTrack })`
 * working after that option moved out of core.
 */
export function createBrowserAnalytics(
  config: BrowserAnalyticsConfig,
): Analytics {

  const analytics = new Analytics(config);

  if (config.autoTrack) {

    analytics.registerTracker(
      startAutoTrack(analytics, config.autoTrack)
    );

  }

  return analytics;

}
