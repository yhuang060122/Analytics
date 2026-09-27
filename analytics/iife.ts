// analytics/iife.ts

/**
 * Entry point of the `<script>` build, declared as the IIFE
 * entry in `tsup.config.ts`. It exists to be bundled into
 * `dist/analytics.iife.js` and nothing imports it — least of
 * all the public barrel, which stays side-effect free.
 *
 * That asymmetry is the whole design: a bundler gets
 * `import { init } from "analytics"` and decides when (and
 * whether) tracking starts. A script tag cannot pass
 * arguments, so this file does the deciding instead and
 * reads its configuration from a global:
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
import { init, registerDetectedAdapters } from "./adapters";
import type { InitOptions } from "./adapters";

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

function readOptions(scope: Record<string, unknown>): InitOptions | undefined {
  const options = scope[OPTIONS_KEY];

  if (!options || typeof options !== "object") return undefined;

  return options as InitOptions;
}

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

  // Both are idempotent, so loading this script twice — or
  // alongside an app that already called `init()` — is safe:
  // one instance, one set of probes.
  void registerDetectedAdapters(init(options));
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
