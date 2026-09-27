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
   * Which browser probes to install.
   *
   * This is the real, supported switch — `init()` defaults it
   * to `{ page: true, click: true }`. It lives here rather
   * than on `AnalyticsConfig` because "page" and "click" are
   * adapter concepts: core cannot name them without knowing
   * about adapters.
   */
  autoTrack?: AutoTrackOptions;
}

/**
 * Composition root in a box: creates the SDK and wires the
 * browser probes the config asked for.
 *
 * This is what `init()` uses, and what you want instead of
 * `new Analytics(...)` when you still expect clicks and page
 * views to be tracked.
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
