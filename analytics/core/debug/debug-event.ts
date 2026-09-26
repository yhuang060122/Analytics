import { AnalyticsContext } from "../domain/context";

export type PipelineStage =
  | "created"
  | "queued"
  | "flushing"
  | "sent"
  | "failed";

export interface DebugEvent {
  stage: PipelineStage;
  context: AnalyticsContext;
  timestamp: number;
  durationMs?: number;
  error?: string;
}
