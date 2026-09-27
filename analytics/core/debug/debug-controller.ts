// core/debug/debug-controller.ts

import { DebugEventBus } from "./event-bus";
import type { DebugInspector } from "./debug-inspector";
import {
  CONSOLE_PLUGIN,
  createConsolePlugin,
} from "./console-plugin";
import {
  INSPECTOR_PLUGIN,
  InspectorDebugPlugin,
} from "./inspector-plugin";
import type { DebugEvent } from "./debug-event";
import type { DebugPlugin } from "./plugin";

export interface DebugOptions {
  enabled?: boolean;
  console?: boolean;
  inspector?: boolean;
}

interface PluginEntry {
  plugin: DebugPlugin;
  unsubscribe: () => void;
}

export class DebugController {

  readonly bus = new DebugEventBus();

  private readonly plugins = new Map<string, PluginEntry>();

  private enabled = false;

  constructor(options: DebugOptions = {}) {

    if (options.enabled) {
      this.enable(options);
    }

  }

  emit(event: DebugEvent): void {

    if (!this.enabled) return;

    this.bus.emit(event);

  }

  /**
   * The two built-ins are plugins like any other: the flags
   * only decide which names get installed into the registry.
   */
  enable(options: DebugOptions = {}): void {

    this.enabled = true;

    if (options.console) {
      this.console(true);
    }

    if (options.inspector) {
      this.inspector(true);
    }

  }

  disable(): void {

    this.enabled = false;

    this.console(false);
    this.inspector(false);

  }

  /** Install or remove the built-in console logger. */
  console(enable: boolean): void {

    if (enable) {
      this.installBuiltIn(CONSOLE_PLUGIN);
      return;
    }

    this.unregisterDebugPlugin(CONSOLE_PLUGIN);

  }

  /** Install or remove the built-in on-page panel. */
  inspector(enable: boolean): void {

    if (enable) {
      this.installBuiltIn(INSPECTOR_PLUGIN);
      return;
    }

    this.unregisterDebugPlugin(INSPECTOR_PLUGIN);

  }

  /**
   * Attach a plugin: anything that wants to watch the pipeline
   * without being wired into the SDK.
   *
   * Returns an unregister function, so `const off = register(p)`
   * and `off()` read the same way as `bus.subscribe()` does.
   *
   * Registering the same `name` twice replaces the earlier
   * plugin — a hot reload would otherwise leave two copies
   * subscribed and deliver every event twice.
   */
  registerDebugPlugin(plugin: DebugPlugin): () => void {

    this.unregisterDebugPlugin(plugin.name);

    // If this plugin ever fails often enough for the bus to
    // drop it, drop it here too — otherwise `debugPlugins`
    // would keep listing a subscriber that receives nothing.
    const unsubscribe = this.bus.subscribe(
      event => plugin.onEvent(event),
      { onDrop: () => this.unregisterDebugPlugin(plugin.name) },
    );

    this.plugins.set(plugin.name, { plugin, unsubscribe });

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

    entry.unsubscribe();
    entry.plugin.stop?.();
    this.plugins.delete(name);

    return true;

  }

  /** Names of the plugins currently attached. */
  get debugPlugins(): string[] {
    return [...this.plugins.keys()];
  }

  /**
   * The on-page inspector panel, if the built-in is installed.
   * Host apps can mount controls into it via
   * `getInspector()?.getToolbar()`.
   */
  getInspector(): DebugInspector | undefined {

    const entry = this.plugins.get(INSPECTOR_PLUGIN);

    return entry?.plugin instanceof InspectorDebugPlugin
      ? entry.plugin.getInspector()
      : undefined;

  }

  /**
   * Release every plugin, built-ins included. Called by
   * `Analytics.destroy()` / `close()`, so a host-registered
   * plugin never outlives the SDK.
   */
  teardown(): void {

    [...this.plugins.keys()].forEach(name =>
      this.unregisterDebugPlugin(name)
    );

  }

  private installBuiltIn(name: string): void {

    if (this.plugins.has(name)) return;

    const plugin =
      name === CONSOLE_PLUGIN
        ? createConsolePlugin()
        : new InspectorDebugPlugin();

    this.registerDebugPlugin(plugin);

  }

}
