// adapters/index.ts

import { Analytics } from "../core/api/analytics";
import type { Tracker } from "../core/api/tracker";
import { FetchTracker } from "./browser/fetch-tracker";
import {
  createBrowserAnalytics,
  type BrowserAnalyticsConfig,
} from "./browser/auto-track";
import { isAngularAvailable, isJQueryAvailable } from "./detect";
import { setActiveRecorder } from "./network/active-recorder";
import type { NetworkTrackerOptions } from "./network/network-core";

export interface NetworkInitOptions extends NetworkTrackerOptions {
  /** Patch window.fetch. Default: true when fetch exists. */
  fetch?: boolean;

  /** Hook $.ajax global events. Default: true when jQuery exists. */
  jquery?: boolean;
}

/**
 * Everything that steers adapter selection, without the
 * SDK config. Kept separate so `registerDetectedAdapters()`
 * can be called later without re-passing `endpoint`.
 */
export interface FrameworkOptions {
  /**
   * Network tracking configuration, or false to disable it
   * entirely.
   */
  network?: NetworkInitOptions | false;

  /** Force-enable or disable a framework adapter. */
  frameworks?: {
    jquery?: boolean;
    angular?: boolean;
  };
}

export interface InitOptions
  extends BrowserAnalyticsConfig,
    FrameworkOptions {
  /**
   * Expose the instance as `window[name]`. For script-tag
   * installs that cannot import.
   * Default: "analytics".
   */
  globalName?: string | false;
}

export interface AdapterReport {
  fetch: "registered" | "skipped" | "unavailable";
  jquery: "registered" | "skipped" | "unavailable";
  angular: "manual" | "unavailable";
}

/**
 * The single instance created by `init()`.
 *
 * Held module-level so a script tag included twice, or an app
 * that calls `init()` from two entry points, still ends up
 * with one SDK and one set of probes.
 */
let instance: Analytics | undefined;

/**
 * Composition root. Creates the SDK, starts what the current
 * runtime actually supports, and ignores the rest.
 *
 * Synchronous, and idempotent: calling it twice returns the
 * first instance instead of registering a second set of
 * probes (which would double every event).
 */
export function init(options: InitOptions): Analytics {
  if (instance) {
    return instance;
  }

  const config: BrowserAnalyticsConfig = {
    autoTrack: { page: true, click: true },
    ...options,
  };

  const analytics = createBrowserAnalytics(config);

  applyNetworkOptions(analytics, options);

  setActiveRecorder(analytics);

  exposeGlobal(analytics, options.globalName);

  instance = analytics;

  return analytics;
}

/** The instance created by `init()`, if any. */
export function getAnalytics(): Analytics | undefined {
  return instance;
}

/**
 * Tears the singleton down. Mostly for tests and for SPA
 * hot-reload, where a second `init()` must be able to run.
 */
export function reset(): void {
  instance?.destroy();
  instance = undefined;
}

/**
 * Registers the adapters that can only be wired after a
 * dynamic import: jQuery today, anything else later.
 *
 * Angular is intentionally absent: an interceptor cannot
 * attach itself to HttpClient, the app must provide it. The
 * report says so instead of silently doing nothing.
 */
export async function registerDetectedAdapters(
  analytics: Analytics = instance!,
  options: FrameworkOptions = {},
): Promise<AdapterReport> {
  const report: AdapterReport = {
    fetch: "unavailable",
    jquery: "unavailable",
    angular: "unavailable",
  };

  const network = options.network === false ? undefined : options.network;
  const wanted = options.frameworks?.jquery ?? true;

  if (wanted && isJQueryAvailable()) {
    const { JQueryAjaxTracker } = await import("./jquery/index");

    const tracker: Tracker = new JQueryAjaxTracker(
      analytics,
      network ?? {},
    );

    tracker.start();
    analytics.registerTracker(tracker);

    report.jquery = "registered";
  } else if (isJQueryAvailable()) {
    report.jquery = "skipped";
  }

  if (isAngularAvailable()) {
    report.angular = "manual";
  }

  return report;
}

function applyNetworkOptions(
  analytics: Analytics,
  options: InitOptions,
): void {
  const network = options.network;

  if (network === false) return;

  const wantsFetch = network?.fetch ?? true;

  if (!wantsFetch) return;

  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }

  const tracker = new FetchTracker(analytics, network ?? {});

  tracker.start();
  analytics.registerTracker(tracker);
}

/**
 * One global, and only when asked for. Everything else the
 * SDK creates lives on the instance.
 */
function exposeGlobal(
  analytics: Analytics,
  name: string | false | undefined,
): void {
  const key = name === false ? undefined : (name ?? "analytics");

  if (!key) return;

  if (typeof window === "undefined") return;

  const scope = window as unknown as Record<string, unknown>;

  if (scope[key]) return;

  scope[key] = analytics;
}
