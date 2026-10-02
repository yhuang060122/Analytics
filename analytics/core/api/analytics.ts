import { DebugController } from "../debug/debug-controller";
import { hasDom } from "../dom";
import { EventFactory } from "../factory";
import { EventQueue, type FlushOptions } from "../queue";
import { HttpDestination } from "../transport";
import { warnOnce } from "../warn";
import type { AnalyticsContext } from "../domain";
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
    if (document.visibilityState !== "hidden") return;

    // Hidden usually means the page is cached or about to be
    // discarded: the batch has one shot, so it asks to be
    // allowed to outlive the document.
    void this.flush({ keepalive: true });
  };

  private readonly handleUnload = (): void => {
    void this.flush({ keepalive: true });
  };

  constructor(config: AnalyticsConfig) {
    this.debug = new DebugController(config.debug);

    const destination = new HttpDestination(
      {
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        headers: config.headers,
        timeoutMs: config.timeoutMs,
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
   * start is the composition root's decision — call
   * `start()` once the probes are registered, or start
   * each probe by hand.
   */
  registerTracker(tracker: Tracker): void {
    this.trackers.push(tracker);
  }

  /**
   * Start every registered probe.
   *
   * `Tracker.start()` is idempotent, so a probe already
   * running is unaffected; one whose runtime is missing
   * (its `canStart()` returns false) simply stays stopped
   * and can be started later once the runtime appears.
   */
  start(): void {
    for (const tracker of this.trackers) {
      tracker.start();
    }
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

  /**
   * Build the context and hand it to the queue, without ever
   * letting a failure reach the caller.
   *
   * `track()` is called from inside the host app's own click
   * handlers. Anything that can throw in there — no `crypto`,
   * no `location`, a queue that refuses the event — would take
   * the click down with it, so the worst case is a dropped
   * event and one warning.
   */
  private record(
    build: () => AnalyticsContext,
  ): void {

    if (this.destroyed) return;

    try {

      this.queue.enqueue(build());

    } catch (error) {

      warnOnce(
        "record-failed",
        "could not record an event; it was dropped. " +
          `The host app was not affected (${String(error)})`,
      );

    }
  }

  track(
    name: string,
    properties: Record<string, unknown> = {}
  ): void {

    this.record(() => this.factory.track(name, properties));

  }

  page(
    path?: string,
    properties: Record<string, unknown> = {}
  ): void {

    this.record(() => this.factory.page(path, properties));

  }

  /**
   * Ship what is buffered.
   *
   * `keepalive` is for the last request of the page — see
   * `FlushOptions`. If a flush is already running this returns
   * that one instead, and its keepalive setting wins.
   */
  flush(options?: FlushOptions): Promise<void> {
    return this.queue.flush(options);
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
