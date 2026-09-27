import type { DebugOptions } from "../debug/debug-controller";

/**
 * Re-exported so the root barrel still carries it. The
 * definition lives next to the class that consumes it — it
 * used to be duplicated here.
 */
export type { DebugOptions };

export interface AnalyticsConfig {
  endpoint: string;

  batchSize?: number;

  flushInterval?: number;

  /**
   * How many times a failing batch is retried before the
   * events are dropped. Defaults to 3.
   */
  maxRetries?: number;

  /**
   * Base delay before the first retry, doubling each time.
   * Defaults to 1000ms, capped at 30s.
   */
  retryDelay?: number;

  /**
   * Hard cap on buffered events (default 500). When full, the
   * oldest event is dropped rather than let the buffer grow
   * without bound during an outage.
   */
  maxQueueSize?: number;

  apiKey?: string;

  headers?: Record<string, string>;

  debug?: DebugOptions;
}