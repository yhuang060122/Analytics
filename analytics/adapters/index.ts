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
 * The result of `init()`, kept until `reset()` tears it down.
 *
 * Named after its lifecycle: `init()` installs the SDK, `reset()`
 * uninstalls it. `installed.instance` reads as "the instance the
 * SDK has been installed with" and `reset()` reads as "go back
 * to never having been installed".
 *
 * It used to be three separate declarations, which meant every
 * new piece needed a matching line in `reset()` — forget one
 * and a hot reload would come back half-initialised. One object
 * lets `reset()` drop it in a single assignment.
 */
interface InstallState {

  /**
   * The single instance created by `init()`.
   *
   * Held module-level so a script tag included twice, or an app
   * that calls `init()` from two entry points, still ends up
   * with one SDK and one set of probes.
   */
  instance?: Analytics;

  /**
   * The network adapters that are live right now.
   *
   * Needed because these adapters patch globals. Registering a
   * second FetchTracker would capture the *already patched*
   * fetch as its "original", so one request would emit two
   * `API Request` events. The bookkeeping makes every register
   * call idempotent instead.
   */
  fetchTracker?: Tracker;
  jqueryTracker?: Tracker;

  /**
   * The framework options `init()` was called with.
   *
   * So `registerDetectedAdapters()` with no arguments finishes
   * what init would have done, instead of silently ignoring
   * `network: false` and re-enabling everything.
   */
  lastOptions: FrameworkOptions;
}

function emptyInstall(): InstallState {
  return {
    lastOptions: {},
  };
}

let installed: InstallState = emptyInstall();

/**
 * Composition root. Creates the SDK, starts what the current
 * runtime actually supports, and ignores the rest.
 *
 * Synchronous, and idempotent: calling it twice returns the
 * first instance instead of registering a second set of
 * probes (which would double every event).
 */
export function init(options: InitOptions): Analytics {
  if (installed.instance) {
    return installed.instance;
  }

  const config: BrowserAnalyticsConfig = {
    autoTrack: { page: true, click: true },
    ...options,
  };

  installed.lastOptions = {
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

  installed.instance = analytics;

  return analytics;
}

/** The instance created by `init()`, if any. */
export function getAnalytics(): Analytics | undefined {
  return installed.instance;
}

/**
 * Tears the singleton down. Mostly for tests and for SPA
 * hot-reload, where a second `init()` must be able to run.
 *
 * One assignment, so no future field can be left behind.
 */
export function reset(): void {
  installed.instance?.destroy();

  installed = emptyInstall();

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
  if (installed.fetchTracker) return true;

  if (!isFetchAvailable()) return false;

  const tracker = new FetchTracker(analytics, options ?? {});

  tracker.start();
  analytics.registerTracker(tracker);

  installed.fetchTracker = tracker;

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
  analytics: Analytics = installed.instance!,
  options: FrameworkOptions = {},
): Promise<AdapterReport> {
  const report: AdapterReport = {
    fetch: "unavailable",
    jquery: "unavailable",
    angular: "unavailable",
  };

  // Explicit arguments win, init()'s config is the fallback.
  const merged: FrameworkOptions = {
    ...installed.lastOptions,
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

  if (installed.jqueryTracker) {
    report.jquery = "registered";
  } else if (!wantsJquery || merged.network === false) {
    report.jquery = isJQueryAvailable() ? "skipped" : "unavailable";
  } else if (isJQueryAvailable()) {
    const { JQueryAjaxTracker } = await import("./jquery/index");

    const tracker: Tracker = new JQueryAjaxTracker(analytics, network ?? {});

    tracker.start();
    analytics.registerTracker(tracker);

    installed.jqueryTracker = tracker;

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
