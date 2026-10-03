import type { ProbeFactory } from "./tracker";

export type { ProbeFactory };

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

  /**
   * Extra headers on every request. This is how auth travels:
   * there is no `apiKey` shorthand, because a shorthand picks
   * one header name and one auth scheme on the host's behalf,
   * and the header a collector wants is not always the header
   * it asked for. `Authorization`, `X-API-Key` and a signed
   * header are all one line here.
   */
  headers?: Record<string, string>;

  /**
   * Report the pipeline to the console.
   *
   * A boolean, not an options object: the console is the only
   * sink, so there was nothing a second field could decide.
   * Off by default — a shipped page should not narrate itself.
   */
  debug?: boolean;

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