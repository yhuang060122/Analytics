// adapters/index.ts

import { Analytics } from "../core/api/analytics";
import type { Tracker } from "../core/api/tracker";
import { FetchTracker } from "./browser/fetch-tracker";
import {
  createBrowserAnalytics,
  type BrowserAnalyticsConfig,
} from "./browser/auto-track";
import {
  isAngularAvailable,
  isFetchAvailable,
  isJQueryAvailable,
} from "./detect";
import {
  clearActiveRecorder,
  setActiveRecorder,
} from "./network/active-recorder";
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
    fetch?: boolean;
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
 * Which network adapters are live right now.
 *
 * Needed because these adapters patch globals. Registering a
 * second FetchTracker would capture the *already patched*
 * fetch as its "original", so one request would emit two
 * `API Request` events. The bookkeeping makes every register
 * call idempotent instead.
 */
const live: { fetch?: Tracker; jquery?: Tracker } = {};

/**
 * The framework options `init()` was called with.
 *
 * So `registerDetectedAdapters()` with no arguments finishes
 * what init would have done, instead of silently ignoring
 * `network: false` and re-enabling everything.
 */
let lastOptions: FrameworkOptions = {};

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

  lastOptions = {
    network: options.network,
    frameworks: options.frameworks,
  };

  const analytics = createBrowserAnalytics(config);

  const network = options.network === false ? undefined : options.network;

  if ((options.frameworks?.fetch ?? true) && options.network !== false) {
    registerFetchAdapter(
      analytics,
      network?.fetch === false ? undefined : network,
    );
  }

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

  live.fetch = undefined;
  live.jquery = undefined;

  clearActiveRecorder();
}

/**
 * Detect and register the fetch adapter. Public, idempotent.
 *
 * Returns false when there is no `window.fetch` to patch
 * (SSR, very old browser) — callers can treat that as "this
 * runtime cannot track network calls".
 *
 * `init()` already calls it; use it directly only when you
 * build the SDK yourself with `new Analytics(...)` and still
 * want the detection behaviour.
 */
export function registerFetchAdapter(
  analytics: Analytics,
  options?: NetworkTrackerOptions,
): boolean {
  if (live.fetch) return true;

  if (!isFetchAvailable()) return false;

  const tracker = new FetchTracker(analytics, options ?? {});

  tracker.start();
  analytics.registerTracker(tracker);

  live.fetch = tracker;

  return true;
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

  // Explicit arguments win, init()'s config is the fallback.
  const merged: FrameworkOptions = {
    ...lastOptions,
    ...options,
  };

  const network = merged.network === false ? undefined : merged.network;

  // ---- fetch ----
  const wantsFetch =
    merged.frameworks?.fetch ?? (network?.fetch ?? true);

  if (merged.network === false || !wantsFetch) {
    report.fetch = isFetchAvailable() ? "skipped" : "unavailable";
  } else {
    report.fetch = registerFetchAdapter(analytics, network)
      ? "registered"
      : "unavailable";
  }

  // ---- jQuery ----
  const wantsJquery = merged.frameworks?.jquery ?? true;

  if (live.jquery) {
    report.jquery = "registered";
  } else if (!wantsJquery || merged.network === false) {
    report.jquery = isJQueryAvailable() ? "skipped" : "unavailable";
  } else if (isJQueryAvailable()) {
    const { JQueryAjaxTracker } = await import("./jquery/index");

    const tracker: Tracker = new JQueryAjaxTracker(analytics, network ?? {});

    tracker.start();
    analytics.registerTracker(tracker);

    live.jquery = tracker;

    report.jquery = "registered";
  }

  // ---- Angular ----
  if (isAngularAvailable()) {
    report.angular = "manual";
  }

  return report;
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
