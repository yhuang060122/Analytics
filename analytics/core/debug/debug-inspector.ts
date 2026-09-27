// core/debug/debug-inspector.ts

import type { DebugEvent } from "./debug-event";
import { STAGE_COLORS } from "./stage-colors";

/**
 * Rows the panel keeps, and the cap on the buffer behind it.
 * One constant so the two cannot disagree.
 */
const MAX_ROWS = 30;

/**
 * The on-page panel.
 *
 * It no longer subscribes to the bus itself: the inspector is
 * now a plugin, and `InspectorDebugPlugin` forwards events to
 * `onEvent()`. That keeps the panel a plain renderer, and makes
 * its lifetime the plugin's lifetime.
 */
export class DebugInspector {

  private panel?: HTMLDivElement;
  private body?: HTMLDivElement;
  private toolbarSlot?: HTMLDivElement;
  private list?: HTMLDivElement;
  private minimizeBtn?: HTMLButtonElement;
  private readonly events: DebugEvent[] = [];

  /** Rows waiting for the next frame. */
  private readonly pending: DebugEvent[] = [];
  private frame?: number;
  private collapsed = false;

  start(): void {

    if (this.panel) return;

    this.createPanel();

  }

  stop(): void {

    this.minimizeBtn?.removeEventListener("click", this.handleToggle);
    this.cancelFrame();

    this.panel?.remove();
    this.panel = undefined;
    this.body = undefined;
    this.toolbarSlot = undefined;
    this.list = undefined;
    this.minimizeBtn = undefined;

    this.events.length = 0;
    this.pending.length = 0;

  }

  /**
   * Named so `stop()` can detach it. The button dies with the
   * panel anyway, but an explicit detach keeps "every listener
   * can be removed" true without exceptions.
   */
  private readonly handleToggle = (): void => this.toggle();

  /**
   * Slot where the host app can mount its own
   * controls (flush button, outage switch, ...).
   * Undefined until start().
   */
  getToolbar(): HTMLDivElement | undefined {
    return this.toolbarSlot;
  }

  /**
   * Collapse / expand the panel. The header
   * (with the toggle button) always stays visible.
   */
  toggle(collapsed?: boolean): void {
    this.collapsed = collapsed ?? !this.collapsed;
    this.applyCollapsed();

    // Rows queued for the next frame are dropped either way:
    // on collapse they must not land in a hidden panel, and on
    // expand renderList() rebuilds the same rows from `events`.
    this.cancelFrame();
    this.pending.length = 0;

    // Events that arrived while collapsed were buffered, not
    // rendered, so the list has to be rebuilt on the way back.
    if (!this.collapsed) {
      this.renderList();
    }
  }

  private applyCollapsed(): void {

    if (!this.body || !this.minimizeBtn) return;

    this.body.style.display =
      this.collapsed ? "none" : "block";

    this.minimizeBtn.textContent =
      this.collapsed ? "+" : "–";

    this.minimizeBtn.setAttribute(
      "aria-label",
      this.collapsed ? "Expand inspector" : "Minimize inspector"
    );

  }

  /**
   * Whether rendering is worth doing right now.
   *
   * A collapsed panel — or a background tab — does not need
   * rows built for it; the events are buffered and rendered
   * when the panel is expanded again.
   */
  private visible(): boolean {
    return !this.collapsed && document.hidden !== true;
  }

  /** Feed one pipeline event into the panel. */
  onEvent(event: DebugEvent): void {

    this.events.unshift(event);

    if (this.events.length > MAX_ROWS) {
      this.events.pop();
    }

    // Rebuilding every row on every event meant ~150 DOM nodes
    // per event, which is what made a burst of events jank the
    // page. One row goes in at the front instead, and a burst
    // collapses into a single frame instead of one layout per
    // event.
    if (!this.visible()) return;

    this.pending.push(event);
    this.schedule();

  }

  /**
   * Coalesce a burst into one paint.
   *
   * Without rAF (SSR, node tests) there is no frame to wait for,
   * so the rows go in immediately — the panel is never mounted
   * in those runtimes anyway.
   */
  private schedule(): void {

    if (this.frame !== undefined) return;

    if (typeof requestAnimationFrame !== "function") {

      this.flushPending();
      return;

    }

    this.frame = requestAnimationFrame(() => {

      this.frame = undefined;
      this.flushPending();

    });

  }

  private cancelFrame(): void {

    if (this.frame === undefined) return;

    cancelAnimationFrame(this.frame);

    this.frame = undefined;

  }

  private flushPending(): void {

    // Arrival order: each row goes to the front, so the last
    // one inserted is the newest and ends up on top.
    for (const event of this.pending) {
      this.prependRow(event);
    }

    this.pending.length = 0;

  }

  private prependRow(event: DebugEvent): void {

    if (!this.list) return;

    this.list.insertBefore(
      this.renderRow(event),
      this.list.firstChild
    );

    while (this.list.children.length > MAX_ROWS) {

      const last = this.list.lastChild;

      if (!last) break;

      this.list.removeChild(last);

    }

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
      display:flex;
      flex-direction:column;
      background:#111827;
      color:#F9FAFB;
      font:12px Inter,sans-serif;
      border-radius:12px;
      box-shadow:0 8px 30px rgba(0,0,0,.35);
      z-index:999999;
      overflow:hidden;
    `;

    // --- header (always visible) ---
    const header = document.createElement("div");

    header.style.cssText = `
      display:flex;
      align-items:center;
      justify-content:space-between;
      padding:10px 12px;
      font-weight:700;
      border-bottom:1px solid #374151;
      flex-shrink:0;
      user-select:none;
    `;

    const title = document.createElement("span");
    title.textContent = "Analytics Inspector";

    this.minimizeBtn = document.createElement("button");

    this.minimizeBtn.textContent = "–";

    this.minimizeBtn.style.cssText = `
      all:unset;
      cursor:pointer;
      width:20px;
      height:20px;
      line-height:18px;
      text-align:center;
      border-radius:6px;
      background:#374151;
      color:#F9FAFB;
      font-weight:700;
    `;

    this.minimizeBtn.addEventListener(
      "click",
      this.handleToggle
    );

    header.appendChild(title);
    header.appendChild(this.minimizeBtn);

    // --- collapsible body ---
    this.body = document.createElement("div");

    this.body.style.cssText = `
      overflow-y:auto;
      min-height:0;
    `;

    // toolbar slot for host-app controls
    this.toolbarSlot = document.createElement("div");

    this.toolbarSlot.id = "analytics-inspector-toolbar";

    this.toolbarSlot.style.cssText = `
      display:none;
      flex-wrap:wrap;
      align-items:center;
      gap:6px;
      padding:8px 12px;
      border-bottom:1px solid #1F2937;
    `;

    this.list = document.createElement("div");

    this.body.appendChild(this.toolbarSlot);
    this.body.appendChild(this.list);

    this.panel.appendChild(header);
    this.panel.appendChild(this.body);

    document.body.appendChild(this.panel);

    this.renderList();

  }

  /**
   * Show the toolbar slot. Called by the host app
   * once it has mounted its controls.
   */
  showToolbar(): void {

    if (!this.toolbarSlot) return;

    this.toolbarSlot.style.display = "flex";

  }

  private renderList(): void {

    if (!this.list) return;

    this.list.textContent = "";

    for (const event of this.events) {
      this.list.appendChild(this.renderRow(event));
    }

  }

  private renderRow(event: DebugEvent): HTMLDivElement {

    const row = document.createElement("div");

    row.style.cssText = `
      padding:10px 12px;
      border-bottom:1px solid #1F2937;
    `;

    const top = document.createElement("div");
    top.style.cssText =
      "display:flex;justify-content:space-between;gap:8px;";

    const name = document.createElement("b");
    name.textContent = event.context.event.name;

    const stage = document.createElement("span");
    stage.textContent = event.stage.toUpperCase();
    stage.style.color = STAGE_COLORS[event.stage];

    top.appendChild(name);
    top.appendChild(stage);

    const type = document.createElement("div");
    type.textContent = event.context.event.type;
    type.style.cssText = "color:#9CA3AF;margin-top:4px;";

    const url = document.createElement("div");
    url.textContent = event.context.url;
    url.style.cssText = "color:#9CA3AF;word-break:break-all;";

    row.appendChild(top);
    row.appendChild(type);
    row.appendChild(url);

    if (event.durationMs !== undefined) {

      const duration = document.createElement("div");
      duration.textContent = `${event.durationMs} ms`;
      duration.style.color = "#22C55E";

      row.appendChild(duration);

    }

    if (event.error) {

      const error = document.createElement("div");

      error.textContent = event.reason
        ? `[${event.reason}] ${event.error}`
        : event.error;

      error.style.cssText =
        "color:#EF4444;margin-top:4px;word-break:break-word;";

      row.appendChild(error);

    }

    return row;

  }

}
