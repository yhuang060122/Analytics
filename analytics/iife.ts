// analytics/iife.ts

/**
 * Entry point of the `<script>` build, declared as the IIFE
 * entry in `tsup.config.ts`. It exists to be bundled into
 * `dist/analytics.iife.js` and nothing imports it — least of
 * all the public barrel, which stays side-effect free.
 *
 * That asymmetry is the whole design: whoever imports the
 * library decides when (and whether) tracking starts. A
 * script tag cannot pass arguments, so this file does the
 * deciding instead and reads its configuration from a
 * global:
 *
 *   <script>
 *     window.analyticsOptions = { endpoint: "/api/analytics/events" };
 *   </script>
 *   <script src="/analytics.iife.js"></script>
 *
 * Deferred to DOMContentLoaded while the document is still
 * parsing, so the two tags above work in either order. Once
 * parsing is done (script injected later,AMD loader, bookmark-
 * let) it installs right away instead.
 */
import { Analytics } from "./core/api/analytics";
import type { AnalyticsConfig } from "./core/api/config";
import { ClickTracker } from "./adapters/browser/click-tracker";
import { FetchTracker } from "./adapters/browser/fetch-tracker";
import { PageTracker } from "./adapters/browser/page-tracker";

/** The global a script tag configures through. */
const OPTIONS_KEY = "analyticsOptions";

/**
 * Never missing, just sometimes absent: a script tag may run
 * in a runtime without `window` at all, and this module must
 * not be the reason a page throws.
 */
function globalScope(): Record<string, unknown> | undefined {
  if (typeof window === "undefined") return undefined;

  return window as unknown as Record<string, unknown>;
}

function readOptions(
  scope: Record<string, unknown>,
): AnalyticsConfig | undefined {
  const options = scope[OPTIONS_KEY];

  if (!options || typeof options !== "object") return undefined;

  return options as AnalyticsConfig;
}

/**
 * Wire the three built-in probes. Each is constructed, started
 * and registered explicitly — there is no runtime detection and
 * no registry: a `<script>` cannot pass function references, so
 * the probes are fixed. The instance is exposed on `window` so
 * the app can reach it after the script has run.
 */
function installFromGlobal(): void {
  const scope = globalScope();

  if (!scope) return;

  const options = readOptions(scope);

  if (!options) {
    // Silent every other case, loud here: an unconfigured
    // build looks installed and tracks nothing, which is
    // indistinguishable from "working" until someone checks
    // the network tab.
    console.warn(
      "analytics: window.analyticsOptions is not set, nothing was installed.",
    );

    return;
  }

  const analytics = new Analytics(options);

  const page = new PageTracker(analytics);
  const click = new ClickTracker(analytics);
  const fetch = new FetchTracker(analytics);

  analytics.registerTracker(page);
  analytics.registerTracker(click);
  analytics.registerTracker(fetch);

  analytics.start();

  (scope as Record<string, unknown>)["analytics"] = analytics;
}

const doc = typeof document === "undefined" ? undefined : document;

if (doc && doc.readyState === "loading") {
  // `once` because re-running install cannot do anything new,
  // and a listener left behind outlives its use.
  doc.addEventListener("DOMContentLoaded", installFromGlobal, {
    once: true,
  });
} else {
  installFromGlobal();
}
