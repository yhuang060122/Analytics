// adapters/index.ts

import { Analytics } from "../core/api/analytics";
import type {
  Adapter,
  AnalyticsPlugin,
  PluginHost,
} from "../core/api/plugin";
import { warnOnce } from "../core/warn";
import { createBrowserAnalytics } from "./browser/auto-track";
import type {
  AutoTrackOptions,
  BrowserAnalyticsConfig,
} from "./browser/auto-track";
import { clickAdapter } from "./browser/click-tracker";
import { fetchAdapter } from "./browser/fetch-tracker";
import { pageAdapter } from "./browser/page-tracker";
import {
  clearActiveRecorder,
  setActiveRecorder,
} from "./network/active-recorder";
import type {
  NetworkTrackerOptions,
  NetworkTransport,
} from "./network/network-core";
import {
  getAdapter,
  listAdapters,
  registerAdapter,
} from "./registry";

export type {
  Adapter,
  AdapterIntegration,
  AnalyticsPlugin,
  PluginHost,
} from "../core/api/plugin";
export {
  registerAdapter,
  unregisterAdapter,
  getAdapter,
  listAdapters,
} from "./registry";

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

/**
 * Per-adapter configuration, keyed by adapter name.
 *
 * `false` disables the adapter; an object becomes its options.
 * This is the *general* form of `network` / `frameworks` /
 * `autoTrack`, which remain as aliases for the built-ins. A
 * third-party adapter is configured here the same way:
 *
 *   init({ adapters: { "vue-router": { routes: router } } })
 */
export interface AdapterConfig {
  [name: string]: boolean | Record<string, unknown> | undefined;
}

export interface InitOptions
  extends BrowserAnalyticsConfig,
    FrameworkOptions {
  /**
   * Per-adapter switches and options. Wins over the aliases
   * below because it is the most specific spelling.
   */
  adapters?: AdapterConfig;

  /**
   * Third-party adapters to register before installing. Only
   * needed when the descriptor is not already in the registry
   * via `registerAdapter()`.
   */
  plugins?: Adapter[];

  /**
   * Expose the instance as `window[name]`. For script-tag
   * installs that cannot import.
   * Default: "analytics".
   */
  globalName?: string | false;
}

/**
 * The adapter-selection half of `init()`'s options, with the
 * SDK config stripped off.
 *
 * The install functions take this instead of `InitOptions`, so
 * `registerDetectedAdapters(analytics)` needs no `endpoint` —
 * that belongs to `init()`, which is also the only caller that
 * needs it.
 */
export interface AdapterSelection extends FrameworkOptions {
  adapters?: AdapterConfig;
  autoTrack?: AutoTrackOptions;
}

/** What happened to one adapter during an install. */
export type AdapterStatus =
  | "registered"
  | "skipped"
  | "unavailable"
  | "manual";

/**
 * The result of `installAdapters()` / `registerDetectedAdapters()`.
 *
 * The three well-known names stay top-level for backward
 * compatibility (`report.fetch`, `report.jquery`, `report.angular`);
 * the full table lives under `adapters`, one entry per registered
 * adapter.
 */
export interface AdapterReport {
  fetch: AdapterStatus;
  jquery: AdapterStatus;
  angular: AdapterStatus;

  adapters: Readonly<Record<string, AdapterStatus>>;
}

/**
 * The adapters whose option switches are the legacy `network`
 * object (with its `network.fetch` / `network.jquery` keys) —
 * as opposed to `autoTrack` for the DOM probes, or `adapters.*`
 * for everyone.
 */
const NETWORK_ADAPTERS: readonly string[] = ["fetch", "jquery"];

/**
 * The keys that belong to the adapter layer and therefore never
 * reach core. Stripped before `createBrowserAnalytics` is
 * called, because that constructor must not learn about
 * adapters — the probes are installed through the registry
 * instead, which is the only reason a third party can add one
 * without editing this file.
 */
const ADAPTER_OPTION_KEYS = [
  "autoTrack",
  "network",
  "frameworks",
  "adapters",
  "plugins",
  "globalName",
] as const;

interface ResolvedPlan {
  enabled: boolean;
  options: Record<string, unknown>;
}

/** The state `init()` installs and `reset()` tears down. */
interface InstallState {
  instance?: Analytics;

  /** Adapters started for the current instance, by name. */
  installed: Map<string, { stop(): void }>;

  /** Built-ins registered into the registry? */
  prepared: boolean;

  /** The adapter switches the last `init()` was given. */
  lastOptions: AdapterSelection;
}

function emptyInstall(): InstallState {
  return {
    installed: new Map(),
    prepared: false,
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

  prepare(options.plugins);

  installed.lastOptions = {
    network: options.network,
    frameworks: options.frameworks,
    adapters: options.adapters,
    autoTrack: options.autoTrack,
  };

  const analytics = createBrowserAnalytics(sdkOptions(options));

  const { pending } = installAll(analytics, options);

  // init() is synchronous: async adapters (a dynamic import)
  // are fire-and-forget here, and a rejection is not allowed to
  // become an unhandled rejection.
  pending.forEach(promise =>
    promise.catch(error =>
      console.warn(`[analytics] adapter failed to start: ${String(error)}`)
    ),
  );

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

  for (const entry of installed.installed.values()) {
    entry.stop();
  }

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
  prepare();

  const outcome = installOne(analytics, "fetch", {
    enabled: true,
    options: (options ?? {}) as Record<string, unknown>,
  });

  return outcome?.status === "registered";
}

/**
 * Registers the adapters that can only be wired after a
 * dynamic import: jQuery today, anything else later.
 *
 * Angular is intentionally a "manual" entry: an interceptor
 * cannot attach itself to HttpClient, the app must provide it.
 * The report says so instead of silently doing nothing.
 */
export async function registerDetectedAdapters(
  analytics: Analytics = installed.instance!,
  options: AdapterSelection = {},
): Promise<AdapterReport> {
  prepare();

  // Adapters whose modules are behind a dynamic import.
  const { jqueryAdapter } = await import("./jquery/index");
  const { angularAdapter } = await import("./angular/index");

  registerAdapter(jqueryAdapter);
  registerAdapter(angularAdapter);

  // Explicit arguments win, init()'s config is the fallback.
  const merged: AdapterSelection = {
    ...installed.lastOptions,
    ...options,
  };

  const { statuses, pending } = installAll(analytics, merged);

  await Promise.allSettled(pending);

  return report(statuses);
}

/**
 * Install every registered adapter against one instance, using
 * the same option resolution `init()` uses. Synchronous; async
 * adapters are started and ignored (their rejections are caught).
 *
 * The report is keyed by adapter name, with the three built-in
 * names also surfaced at the top level.
 */
export function installAdapters(
  analytics: Analytics,
  options: AdapterSelection = {},
): AdapterReport {
  prepare();

  const { statuses, pending } = installAll(analytics, options);

  pending.forEach(promise =>
    promise.catch(error =>
      console.warn(`[analytics] adapter failed to start: ${String(error)}`)
    ),
  );

  return report(statuses);
}

/**
 * Register the built-ins into the registry. Idempotent, and
 * deliberately additive: whatever a third party registered
 * first stays.
 */
function prepare(plugins?: Adapter[]): void {
  if (installed.prepared) {
    plugins?.forEach(registerAdapter);
    return;
  }

  installed.prepared = true;

  registerAdapter(clickAdapter);
  registerAdapter(pageAdapter);
  registerAdapter(fetchAdapter);

  plugins?.forEach(registerAdapter);
}

/**
 * Strip the adapter switches out of `init()`'s options, so the
 * SDK constructor never sees them.
 *
 * `Omit` keeps this in sync automatically: a new core option
 * flows through, a new adapter switch is dropped here.
 */
function sdkOptions(options: InitOptions): BrowserAnalyticsConfig {
  const rest = { ...options } as Record<string, unknown>;

  for (const key of ADAPTER_OPTION_KEYS) {
    delete rest[key];
  }

  return rest as unknown as BrowserAnalyticsConfig;
}

function report(
  statuses: Record<string, AdapterStatus>,
): AdapterReport {
  const byName = (name: string): AdapterStatus =>
    statuses[name] ?? "unavailable";

  return {
    fetch: byName("fetch"),
    jquery: byName("jquery"),
    angular: byName("angular"),
    adapters: statuses,
  };
}

interface InstallOutcome {
  status: AdapterStatus;
  pending?: Promise<void>;
}

interface InstallResult {
  statuses: Record<string, AdapterStatus>;
  pending: Promise<void>[];
}

function installAll(
  analytics: Analytics,
  options: AdapterSelection,
): InstallResult {
  const statuses: Record<string, AdapterStatus> = {};
  const pending: Promise<void>[] = [];

  for (const name of listAdapters()) {
    const outcome = installOne(analytics, name, planFor(name, options));

    if (!outcome) continue;

    statuses[name] = outcome.status;

    if (outcome.pending) pending.push(outcome.pending);
  }

  return { statuses, pending };
}

function installOne(
  analytics: Analytics,
  name: string,
  plan: ResolvedPlan,
): InstallOutcome | undefined {
  if (installed.installed.has(name)) {
    return { status: "registered" };
  }

  const adapter = getAdapter(name);

  if (!adapter) return undefined;

  const host: PluginHost = analytics;

  if (!isPlugin(adapter)) {
    // An integration is never auto-started: the app drives it.
    return {
      status: available(adapter, host) ? "manual" : "unavailable",
    };
  }

  if (!plan.enabled) {
    return {
      status: available(adapter, host) ? "skipped" : "unavailable",
    };
  }

  if (adapter.available && !adapter.available(host)) {
    return { status: "unavailable" };
  }

  try {
    const maybePromise = adapter.start(host, plan.options);

    installed.installed.set(name, {
      stop: () => adapter.stop?.(),
    });

    const pending = maybePromise instanceof Promise
      ? maybePromise
      : undefined;

    return { status: "registered", pending };
  } catch (error) {
    // A third-party adapter must not take the SDK — or the page
    // — down with it. Treat it as never installed.
    warnOnce(
      `adapter-${name}-failed`,
      `adapter "${name}" failed to start; it was skipped (${String(error)})`,
    );

    return { status: "unavailable" };
  }
}

function available(adapter: Adapter, host: PluginHost): boolean {
  return adapter.available?.(host) ?? true;
}

function isPlugin(adapter: Adapter): adapter is AnalyticsPlugin {
  return typeof (adapter as AnalyticsPlugin).start === "function";
}

/** The shared option bag a network transport receives. */
function networkOptions(
  network: NetworkInitOptions | undefined,
  transport: NetworkTransport,
): NetworkTrackerOptions {
  return {
    ignoreUrls: network?.ignoreUrls,
    transport,
    normalizeUrl: network?.normalizeUrl,
  };
}

/**
 * One place, one answer: what should adapter `name` do?
 *
 * Precedence, most specific first:
 *
 *   1. `adapters.<name>` — explicit per-adapter config
 *   2. `frameworks.<name>` / `autoTrack.<name>` — force on/off
 *   3. `network.<name>` — per-transport default
 *   4. `network: false` — off for every network transport
 *   5. on
 *
 * This used to be three separate copies (network, frameworks,
 * autoTrack) that could disagree. All of them now land here.
 */
function planFor(name: string, options: AdapterSelection): ResolvedPlan {
  const direct = options.adapters?.[name];

  if (direct !== undefined) {
    return typeof direct === "boolean"
      ? { enabled: direct, options: shared(name, options) }
      : { enabled: true, options: { ...shared(name, options), ...direct } };
  }

  const forced =
    switchIn(options.frameworks, name) ??
    switchIn(options.autoTrack, name);

  if (forced !== undefined) {
    return { enabled: forced, options: shared(name, options) };
  }

  if (NETWORK_ADAPTERS.includes(name)) {
    if (options.network === false) {
      return { enabled: false, options: {} };
    }

    const transport: NetworkTransport =
      name === "jquery" ? "jquery" : "fetch";

    const perTransport = (options.network as
      | Record<string, boolean | undefined>
      | undefined)?.[name];

    if (perTransport !== undefined) {
      return {
        enabled: perTransport,
        options: shared(name, options),
      };
    }

    return {
      enabled: true,
      options: networkOptions(
        options.network ?? undefined,
        transport,
      ) as unknown as Record<string, unknown>,
    };
  }

  return { enabled: true, options: shared(name, options) };
}

function shared(name: string, options: AdapterSelection): Record<string, unknown> {
  if (NETWORK_ADAPTERS.includes(name)) {
    const transport: NetworkTransport =
      name === "jquery" ? "jquery" : "fetch";

    return networkOptions(
      options.network === false ? undefined : options.network,
      transport,
    ) as unknown as Record<string, unknown>;
  }

  return {};
}

function switchIn(
  source: unknown,
  name: string,
): boolean | undefined {
  const value = (source as Record<string, unknown> | undefined)?.[name];

  return typeof value === "boolean" ? value : undefined;
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
