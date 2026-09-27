// core/debug/inspector-plugin.ts

import { DebugInspector } from "./debug-inspector";
import type { DebugEvent } from "./debug-event";
import type { DebugPlugin } from "./plugin";

/** Registry key of the built-in on-page panel. */
export const INSPECTOR_PLUGIN = "inspector";

/**
 * Wraps the on-page panel in the plugin port.
 *
 * The panel is created eagerly, because hosts mount their own
 * controls into it right after `init()` — `getInspector()` must
 * return a live panel, not one that waits for the first event.
 *
 * `stop()` is what makes teardown possible: dropping the plugin
 * removes the panel instead of leaving it behind.
 */
export class InspectorDebugPlugin implements DebugPlugin {

  readonly name = INSPECTOR_PLUGIN;

  private readonly view = new DebugInspector();

  constructor() {
    this.view.start();
  }

  onEvent(event: DebugEvent): void {
    this.view.onEvent(event);
  }

  stop(): void {
    this.view.stop();
  }

  /** The panel, for hosts that mount controls into it. */
  getInspector(): DebugInspector {
    return this.view;
  }

}
