// core/debug/debug-inspector.ts

import { DebugEventBus } from "./event-bus";
import { DebugEvent } from "./debug-event";

export class DebugInspector {

  private panel?: HTMLDivElement;
  private unsubscribe?: () => void;
  private readonly events: DebugEvent[] = [];

  constructor(
    private readonly bus: DebugEventBus
  ) {}

  start(): void {

    if (this.panel) return;

    this.createPanel();

    this.unsubscribe = this.bus.subscribe(
      event => this.onEvent(event)
    );

  }

  stop(): void {

    this.unsubscribe?.();
    this.unsubscribe = undefined;

    this.panel?.remove();
    this.panel = undefined;

    this.events.length = 0;

  }

  private onEvent(event: DebugEvent): void {

    this.events.unshift(event);

    if (this.events.length > 30) {
      this.events.pop();
    }

    this.render();

  }

  private createPanel(): void {

    this.panel = document.createElement("div");

    this.panel.id = "analytics-debug-inspector";

    this.panel.style.cssText = `
      position:fixed;
      right:16px;
      bottom:16px;
      width:340px;
      max-height:420px;
      overflow:auto;
      background:#111827;
      color:#F9FAFB;
      font:12px Inter,sans-serif;
      border-radius:12px;
      box-shadow:0 8px 30px rgba(0,0,0,.35);
      z-index:999999;
    `;

    document.body.appendChild(this.panel);

    this.render();

  }

  private render(): void {

    if (!this.panel) return;

    const rows = this.events
      .map(e => this.renderRow(e))
      .join("");

    this.panel.innerHTML = `
      <div style="
        padding:12px;
        font-weight:700;
        border-bottom:1px solid #374151;
      ">
        Analytics Inspector
      </div>

      ${rows}
    `;

  }

  private renderRow(event: DebugEvent): string {

    const color = {
      created: "#64748B",
      queued: "#F59E0B",
      flushing: "#3B82F6",
      sent: "#22C55E",
      failed: "#EF4444",
    }[event.stage];

    return `
      <div style="
        padding:10px 12px;
        border-bottom:1px solid #1F2937;
      ">

        <div style="
          display:flex;
          justify-content:space-between;
        ">
          <b>${event.context.event.name}</b>

          <span style="color:${color}">
            ${event.stage.toUpperCase()}
          </span>
        </div>

        <div style="color:#9CA3AF;margin-top:4px">
          ${event.context.event.type}
        </div>

        <div style="color:#9CA3AF">
          ${event.context.url}
        </div>

        ${
          event.durationMs !== undefined
            ? `<div style="color:#22C55E">
                 ${event.durationMs} ms
               </div>`
            : ""
        }

        ${
          event.error
            ? `<div style="color:#EF4444">
                 ${event.error}
               </div>`
            : ""
        }

      </div>
    `;

  }

}