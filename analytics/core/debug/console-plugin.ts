// core/debug/console-plugin.ts

import type { DebugEvent } from "./debug-event";
import type { DebugPlugin } from "./plugin";
import { STAGE_COLORS } from "./stage-colors";

/** Registry key of the built-in console logger. */
export const CONSOLE_PLUGIN = "console";

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
