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
 * Three very different outcomes share the stage and could only
 * be told apart by matching on the error text — "queue
 * overflow" for a drop, "dropped after one attempt" for a
 * batch the destination refused, anything else for a transport
 * error. `error` stays free-form (it carries the message); this
 * is the machine-readable half.
 *
 * `undeliverable` is the one to watch: the destination refused
 * the batch and there is no retry, so the events are simply
 * gone. Anything that needs to survive a flaky network has to
 * be shipped by the host, not buffered here.
 *
 * `timeout` is its own case rather than a `transport-error`
 * because the fix is different: nothing was refused, the peer
 * simply never answered.
 */
export type DebugFailureReason =
  | "queue-overflow"
  | "undeliverable"
  | "transport-error"
  | "timeout";

export interface DebugEvent {
  stage: PipelineStage;
  context: AnalyticsContext;
  timestamp: number;
  durationMs?: number;
  error?: string;

  /** Set on `failed` only. */
  reason?: DebugFailureReason;
}
