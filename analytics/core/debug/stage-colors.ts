// core/debug/stage-colors.ts

import type { PipelineStage } from "./debug-event";

/**
 * Single source of truth for stage colours.
 *
 * Typed with `Record<PipelineStage, ...>` so adding a stage to
 * the union fails to compile until a colour exists for it —
 * which is what stopped the console logger and the inspector
 * from drifting apart when they each had their own copy.
 */
export const STAGE_COLORS: Record<PipelineStage, string> = {
  created: "#64748B",
  queued: "#F59E0B",
  flushing: "#3B82F6",
  sent: "#22C55E",
  failed: "#EF4444",
};
