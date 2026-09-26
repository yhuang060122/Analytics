// core/debug/debug-controller.ts

import { DebugEventBus } from "./event-bus";
import { DebugInspector } from "./debug-inspector";
import type { DebugEvent } from "./debug-event";

export interface DebugOptions {
  enabled?: boolean;
  console?: boolean;
  inspector?: boolean;
}

export class DebugController {

  readonly bus = new DebugEventBus();

  private inspectorView?: DebugInspector;
  private consoleUnsubscribe?: () => void;

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

  console(enable: boolean): void {

    this.consoleUnsubscribe?.();
    this.consoleUnsubscribe = undefined;

    if (!enable) return;

    this.consoleUnsubscribe = this.bus.subscribe(event => {

      const color = {
        created: "#64748B",
        queued: "#F59E0B",
        flushing: "#3B82F6",
        sent: "#22C55E",
        failed: "#EF4444",
      }[event.stage];

      console.log(
        `%c${event.stage.toUpperCase()}`,
        `color:${color};font-weight:bold`,
        event.context.event.name,
        event.context.event.properties
      );

    });

  }

  inspector(enable: boolean): void {

    if (!enable) {

      this.inspectorView?.stop();
      this.inspectorView = undefined;

      return;

    }

    if (this.inspectorView) return;

    this.inspectorView = new DebugInspector(this.bus);
    this.inspectorView.start();

  }

  /**
   * The on-page inspector panel, if enabled.
   * Host apps can mount controls into it via
   * `getInspector()?.getToolbar()`.
   */
  getInspector(): DebugInspector | undefined {
    return this.inspectorView;
  }

}