import type { AnalyticsContext } from "../domain/context";

export type PipelineStage =
  | "created"
  | "queued"
  | "flushing"
  | "sent"
  | "failed";

/**
 * Why an event ended up on `failed`.
 *
 * Three very different outcomes used to share the stage and
 * could only be told apart by matching on the error text —
 * "queue overflow" for a drop, "dropped after N attempts" for
 * a batch given up on, anything else for a transport error.
 * `error` stays free-form (it carries the message); this is
 * the machine-readable half.
 *
 * Not "retries-exhausted": with `maxRetries: 0` the batch is
 * dropped on the first failure, so nothing was ever retried.
 * What the two have in common is that the SDK stopped trying.
 */
export type DebugFailureReason =
  | "queue-overflow"
  | "undeliverable"
  | "transport-error";

export interface DebugEvent {
  stage: PipelineStage;
  context: AnalyticsContext;
  timestamp: number;
  durationMs?: number;
  error?: string;

  /** Set on `failed` only. */
  reason?: DebugFailureReason;
}
