import { DebugController } from "../debug/debug-controller";
import { hasDom } from "../dom";
import { EventFactory } from "../factory";
import { EventQueue } from "../queue";
import { HttpDestination } from "../transport";
import type { AnalyticsConfig } from "./config";
import type { EventRecorder, Tracker } from "./tracker";

export class Analytics implements EventRecorder {

  private readonly trackers: Tracker[] = [];

  readonly debug: DebugController;
  private readonly factory: EventFactory;
  private readonly queue: EventQueue;

  private destroyed = false;

  /**
   * Named so `destroy()` can remove them. Anonymous listeners
   * were the reason a destroyed instance kept flushing on
   * every tab switch.
   */
  private readonly handleVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      void this.flush();
    }
  };

  private readonly handleUnload = (): void => {
    void this.flush();
  };

  constructor(config: AnalyticsConfig) {
    this.debug = new DebugController(config.debug);

    const destination = new HttpDestination(
      {
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        headers: config.headers,
      },
      this.debug
    );


    this.queue = new EventQueue(
      destination,
      this.debug,
      {
        batchSize: config.batchSize,
        flushInterval: config.flushInterval,
        maxRetries: config.maxRetries,
        retryDelay: config.retryDelay,
        maxQueueSize: config.maxQueueSize,
      }
    );


    this.factory = new EventFactory(this.debug);

    this.registerLifecycle();

  }

  /**
   * Tear everything down: probes, lifecycle listeners, timers,
   * then one last best-effort flush.
   *
   * Idempotent — a second call does nothing.
   */
  destroy(): void {

    if (this.destroyed) return;
    this.destroyed = true;

    this.unregisterAll();
    this.removeLifecycle();
    this.queue.stop();

    // Best effort: whatever is still buffered gets one final
    // chance. The retry timer is already stopped, so this is
    // the last attempt, not the first of a series.
    //
    // Debug plugins are torn down once that settles, so they
    // still see the last "sent" events — but they do not
    // outlive the instance.
    void this.flush().finally(() => this.debug.teardown());

  }

  /**
   * Awaitable teardown: waits for the buffered events to be
   * shipped (or to fail) before stopping the queue. Unlike
   * `destroy()` it does not leave a request in flight.
   */
  async close(): Promise<void> {

    if (this.destroyed) return;
    this.destroyed = true;

    this.unregisterAll();
    this.removeLifecycle();

    await this.flush();

    this.queue.stop();
    this.debug.teardown();

  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Register a probe. It is NOT started here: when to
   * start is the composition root's decision.
   */
  registerTracker(tracker: Tracker): void {
    this.trackers.push(tracker);
  }

  /**
   * Stop a probe and drop it from the registry.
   */
  unregisterTracker(tracker: Tracker): void {

    const index = this.trackers.indexOf(tracker);

    if (index === -1) return;

    this.trackers.splice(index, 1);

    tracker.stop();

  }

  private unregisterAll(): void {

    this.trackers
      .splice(0)
      .forEach(tracker => tracker.stop());

  }

  track(
    name: string,
    properties: Record<string, unknown> = {}
  ): void {

    if (this.destroyed) return;

    const context = this.factory.track(name, properties);

    this.queue.enqueue(context);

  }

  page(
    path?: string,
    properties: Record<string, unknown> = {}
  ): void {

    if (this.destroyed) return;

    const context = this.factory.page(path, properties);

    this.queue.enqueue(context);

  }

  flush(): Promise<void> {
    return this.queue.flush();
  }

  clear(): void {
    this.queue.clear();
  }

  get pending(): number {
    return this.queue.size;
  }

  get retrying(): boolean {
    return this.queue.retrying;
  }

  /**
   * Automatically flush when page is hidden.
   */
  private registerLifecycle(): void {

    if (!hasDom()) return;

    document.addEventListener(
      "visibilitychange",
      this.handleVisibility
    );

    window.addEventListener(
      "beforeunload",
      this.handleUnload
    );
  }

  private removeLifecycle(): void {

    if (!hasDom()) return;

    document.removeEventListener(
      "visibilitychange",
      this.handleVisibility
    );

    window.removeEventListener(
      "beforeunload",
      this.handleUnload
    );
  }
}
