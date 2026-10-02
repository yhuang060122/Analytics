import type { DebugOptions } from "../debug/debug-controller";
import type { ProbeFactory } from "./tracker";

/**
 * Re-exported so the root barrel still carries it. The
 * definition lives next to the class that consumes it — it
 * used to be duplicated here.
 */
export type { DebugOptions, ProbeFactory };

export interface AnalyticsConfig {
  endpoint: string;

  batchSize?: number;

  flushInterval?: number;

  /**
   * How long a request may be in flight before it is aborted
   * and treated as a failed attempt. Defaults to 10s; `0`
   * disables it. See `HttpDestinationOptions.timeoutMs`.
   */
  timeoutMs?: number;

  apiKey?: string;

  headers?: Record<string, string>;

  debug?: DebugOptions;

  /**
   * Probes to wire up, in order. Each factory receives the
   * instance as its `EventRecorder` and returns a `Tracker`.
   *
   * Registered but NOT started — `start()` still starts
   * everything at once, exactly as it does for probes added by
   * hand. That is the one rule worth remembering: this option
   * decides *what* is wired, never *when* it runs.
   *
   * Hand-written equivalents stay available and mix freely:
   *
   * ```ts
   * new Analytics({
   *   endpoint,
   *   probes: [recorder => new PageTracker(recorder)],
   * });
   *
   * const click = new ClickTracker(analytics, { attribute });
   * analytics.registerTracker(click);
   * ```
   *
   * A factory that throws is reported and skipped. The
   * alternative would be an exception from a constructor, which
   * is a far worse failure than a probe that quietly is not
   * there.
   */
  probes?: ProbeFactory[];
}