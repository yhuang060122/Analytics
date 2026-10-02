// core/debug/console-plugin.ts

import type { DebugEvent, PipelineStage } from "./debug-event";
import type { DebugPlugin } from "./debug-controller";

/** Registry key of the built-in console logger. */
export const CONSOLE_PLUGIN = "console";

/**
 * One colour per pipeline stage.
 *
 * Typed with `Record<PipelineStage, ...>` so adding a stage to
 * the union fails to compile until a colour exists for it.
 * It lives here rather than in its own module because the
 * console logger is the only thing that renders these — a
 * shared table nobody else reads is a file to keep in sync
 * for nothing.
 */
const STAGE_COLORS: Record<PipelineStage, string> = {
  created: "#64748B",
  queued: "#F59E0B",
  flushing: "#3B82F6",
  sent: "#22C55E",
  failed: "#EF4444",
};

/**
 * The console logger, as an ordinary plugin.
 *
 * Stateless, so it needs no `stop()` — unregistering it simply
 * stops the events from arriving.
 */
export function createConsolePlugin(): DebugPlugin {

  return {

    name: CONSOLE_PLUGIN,

    onEvent(event: DebugEvent): void {

      // The reason rides along on the label: a "failed" event
      // without it looks exactly like every other failure.
      const label = event.reason
        ? `${event.stage.toUpperCase()} · ${event.reason}`
        : event.stage.toUpperCase();

      console.log(
        `%c${label}`,
        `color:${STAGE_COLORS[event.stage]};font-weight:bold`,
        event.context.event.name,
        event.context.event.properties
      );

    },

  };

}
