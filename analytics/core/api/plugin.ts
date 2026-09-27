// core/api/plugin.ts

import type { DebugController } from "../debug/debug-controller";
import type { EventRecorder, Tracker } from "./tracker";

/**
 * What the SDK hands an adapter while installing it.
 *
 * Deliberately not the `Analytics` class: adapters already
 * depend on `EventRecorder` instead, which keeps the arrow
 * pointing adapters -> core. Anything an adapter legitimately
 * needs is here — recording events, keeping its own trackers in
 * the instance's registry, and watching the debug bus.
 */
export interface PluginHost extends EventRecorder {

  /**
   * Hand a probe to the instance so `destroy()` stops it.
   *
   * An adapter that listens to DOM events (or patches a global)
   * almost always builds a `Tracker`; registering it is what
   * makes teardown somebody else's problem.
   */
  registerTracker(tracker: Tracker): void;

  unregisterTracker(tracker: Tracker): void;

  readonly debug: DebugController;
}

/**
 * An adapter the SDK starts and stops.
 *
 * This is what a click probe, a router observer or a `fetch`
 * wrapper is: something that installs itself against the page
 * and releases everything it took.
 *
 * Generic over its own options so a third-party author gets
 * completion on `options` without casting.
 */
export interface AnalyticsPlugin<
  TOptions = Record<string, unknown>,
> {

  /**
   * Identity, and the key every mechanism addresses it by:
   * `init({ adapters: { <name>: false } })`, the install report,
   * `unregisterAdapter(name)`. Lower case, one word where
   * possible — it is a config key more often than it is a label.
   */
  readonly name: string;

  /**
   * Whether this adapter can run in the current runtime.
   *
   * Absent means "always" — a plugin with no environment needs
   * does not have to pretend to check for one.
   *
   * This is deliberately per-adapter: detection used to be a
   * switch table in the composition root, which meant adding a
   * transport meant editing a second file that had to agree
   * with the first.
   */
  available?(host: PluginHost): boolean;

  /**
   * Install the adapter. May be async — an adapter whose module
   * is reached through a dynamic import cannot do otherwise.
   */
  start(
    host: PluginHost,
    options: TOptions,
  ): void | Promise<void>;

  /**
   * Release anything `start()` acquired that is not a registered
   * tracker. Optional because most adapters have nothing here:
   * their whole resource set is the tracker they registered.
   */
  stop?(): void;
}

/**
 * An adapter the *application* drives.
 *
 * The Angular interceptor is the reason this exists: an HTTP
 * interceptor cannot attach itself to `HttpClient`, so there is
 * nothing for the SDK to start. Such an adapter still belongs in
 * the registry — so it shows up in reports and can be looked up
 * by name — but it produces something for the app to install
 * rather than installing itself.
 *
 * Making it pretend to have a lifecycle would have meant a
 * `start()` that does nothing, which is exactly the kind of
 * semantic overload this layer exists to avoid.
 */
export interface AdapterIntegration<
  TOptions = Record<string, unknown>,
  TApi = unknown,
> {
  readonly name: string;

  available?(host: PluginHost): boolean;

  /** Build whatever the app asked this adapter for. */
  create(
    host: PluginHost,
    options: TOptions,
  ): TApi;
}

/**
 * Either kind. One registry, one config key space, one report —
 * two roles, because only one of them can be started by us.
 */
export type Adapter<
  TOptions = Record<string, unknown>,
  TApi = unknown,
> =
  | AnalyticsPlugin<TOptions>
  | AdapterIntegration<TOptions, TApi>;

export function isPlugin(
  adapter: Adapter<never, never>,
): adapter is AnalyticsPlugin<never> {
  return typeof (adapter as AnalyticsPlugin).start === "function";
}

export function isIntegration(
  adapter: Adapter<never, never>,
): adapter is AdapterIntegration<never, never> {
  return typeof (adapter as AdapterIntegration).create === "function";
}
