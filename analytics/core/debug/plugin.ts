// core/debug/plugin.ts

import type { DebugEvent } from "./debug-event";

/**
 * The debug port: anything that wants to observe the pipeline
 * implements this instead of being wired into DebugController.
 *
 * `onEvent` is the only required member; `stop()` is the
 * teardown hook for plugins that own something (the inspector
 * owns a DOM panel). It is called on `unregisterDebugPlugin()`
 * and when the SDK is destroyed, so a plugin never has to be
 * unsubscribed by hand.
 *
 * There is no `start()`: a plugin is built and started by
 * whoever constructs it, which keeps the port to two members.
 */
export interface DebugPlugin {

  /**
   * Identity. Registering a plugin with a name that is already
   * taken replaces the previous one instead of double-delivering
   * every event to both copies.
   */
  readonly name: string;

  onEvent(event: DebugEvent): void;

  /** Optional teardown. Called on unregister and on destroy. */
  stop?(): void;

}
