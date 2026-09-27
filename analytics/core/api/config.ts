import type { DebugOptions } from "../debug/debug-controller";

/**
 * Re-exported so `import type { DebugOptions } from "analytics"`
 * keeps working. The definition lives next to the class that
 * consumes it — it used to be duplicated here.
 */
export type { DebugOptions };

export interface AnalyticsConfig {
  endpoint: string;

  batchSize?: number;

  flushInterval?: number;

  apiKey?: string;

  headers?: Record<string, string>;

  debug?: DebugOptions;
}