// core/debug/debug-controller.ts

import { warnOnce } from "../warn";
import { CONSOLE_PLUGIN, createConsolePlugin } from "./console-plugin";
import type { DebugEvent } from "./debug-event";

export interface DebugOptions {
  enabled?: boolean;
  console?: boolean;
}

/**
 * The debug port: anything that wants to observe the pipeline
 * implements this instead of being wired into the engine.
 *
 * `onEvent` is the only required member; `stop()` is the
 * teardown hook for a plugin that owns something — a timer, a
 * socket, a subscription of its own. It is called on
 * `unregisterDebugPlugin()` and when the SDK is destroyed, so a
 * plugin never has to detach by hand.
 *
 * There is no `start()`: a plugin is built and started by
 * whoever constructs it, which keeps the port to two members.
 */
export interface DebugPlugin {

  /**
   * Identity. Registering a plugin with a name that is already
   * taken replaces the previous one instead of double-delivering
   * every event to both copies — a hot reload would otherwise
   * leave two of everything subscribed.
   *
   * A name is also what makes a plugin detachable. There is
   * deliberately no anonymous subscription: a subscriber the
   * SDK cannot name is a subscriber `destroy()` cannot remove,
   * which is how the previous bus-based design leaked.
   */
  readonly name: string;

  onEvent(event: DebugEvent): void;

  /** Optional teardown. Called on unregister and on destroy. */
  stop?(): void;

}

/**
 * How many failures in a row earn a plugin its removal.
 *
 * Three, not one: a plugin may well throw on the first event
 * because it is still warming up its own client. Throwing on
 * *every* event is a plugin that is never going to work.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

interface PluginEntry {
  plugin: DebugPlugin;
  failures: number;
}

/**
 * The pipeline's observer registry.
 *
 * It used to delegate to a separate event bus, which meant two
 * books of the same subscribers: this class kept a map by name,
 * the bus a set of listeners plus a side table of failure
 * counts, and the two were kept in step by an `onDrop` callback
 * the bus fired whenever it retired a listener. One registry
 * does the whole job, and there is nothing left that can fall
 * out of sync — or survive `destroy()` without being listed.
 */
export class DebugController {

  private readonly plugins = new Map<string, PluginEntry>();

  private readonly enabled: boolean;

  constructor(options: DebugOptions = {}) {

    this.enabled = options.enabled === true;

    if (this.enabled && options.console) {
      this.installBuiltIn();
    }

  }

  emit(event: DebugEvent): void {

    if (!this.enabled) return;

    // Snapshot: retiring a plugin below mutates the map while
    // this loop is running.
    for (const name of [...this.plugins.keys()]) {

      const entry = this.plugins.get(name);

      if (!entry) continue;

      this.deliver(name, entry, event);

    }

  }

  /**
   * Install or remove the built-in console logger. This is the
   * one runtime switch the debug layer keeps: a host that
   * enabled debug for a diagnostic can turn the noise back off
   * without giving up the plugins it registered itself.
   */
  console(enable: boolean): void {

    if (enable) {
      this.installBuiltIn();
      return;
    }

    this.unregisterDebugPlugin(CONSOLE_PLUGIN);

  }

  /**
   * Attach a plugin: anything that wants to watch the pipeline
   * without being wired into the SDK.
   *
   * Returns an unregister function, so `const off = register(p)`
   * and `off()` read the same way.
   */
  registerDebugPlugin(plugin: DebugPlugin): () => void {

    this.unregisterDebugPlugin(plugin.name);

    this.plugins.set(plugin.name, { plugin, failures: 0 });

    return () => this.unregisterDebugPlugin(plugin.name);

  }

  /**
   * Detach a plugin by name and, if it has one, run its
   * teardown. Returns false when nothing was registered under
   * that name.
   */
  unregisterDebugPlugin(name: string): boolean {

    const entry = this.plugins.get(name);

    if (!entry) return false;

    this.plugins.delete(name);

    // The entry is gone from the registry first, so a `stop()`
    // that throws cannot leave a detached plugin still listed.
    try {

      entry.plugin.stop?.();

    } catch (error) {

      warnOnce(
        "plugin-teardown-threw",
        `a debug plugin's stop() threw; the SDK carried on (${String(error)})`,
      );

    }

    return true;

  }

  /** Names of the plugins currently attached. */
  get debugPlugins(): string[] {
    return [...this.plugins.keys()];
  }

  /**
   * Release every plugin, built-in included. Called by
   * `Analytics.destroy()` / `close()`, so a host-registered
   * plugin never outlives the SDK.
   */
  teardown(): void {

    [...this.plugins.keys()].forEach(name =>
      this.unregisterDebugPlugin(name)
    );

  }

  /**
   * One plugin's turn, isolated.
   *
   * The try/catch used to live in the bus and the bookkeeping
   * here, which is why a throwing plugin had two places to be
   * forgotten. A failed plugin must not break the host: this
   * runs inside the SDK's own event emission, which a
   * `ClickTracker` reaches from the application's click
   * handler. Observers are exactly the layer where swallowing a
   * failure is right, because nothing downstream depends on
   * them.
   */
  private deliver(
    name: string,
    entry: PluginEntry,
    event: DebugEvent
  ): void {

    try {

      entry.plugin.onEvent(event);

      entry.failures = 0;

    } catch (error) {

      entry.failures += 1;

      if (entry.failures < MAX_CONSECUTIVE_FAILURES) {

        warnOnce(
          "plugin-threw",
          "a debug plugin threw while handling an event; " +
            `the SDK carried on (${String(error)})`,
        );

        return;

      }

      warnOnce(
        "plugin-disabled",
        `a debug plugin failed ${entry.failures} times in a row and was ` +
          `unsubscribed (${String(error)})`,
      );

      this.unregisterDebugPlugin(name);

    }

  }

  private installBuiltIn(): void {

    // A host plugin already holding the name wins: the flag
    // means "there should be a console logger", not "install
    // one over the top of whatever is already there".
    if (this.plugins.has(CONSOLE_PLUGIN)) return;

    this.registerDebugPlugin(createConsolePlugin());

  }

}
