import { DebugController } from "../debug/debug-controller";
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
      }
    );


    this.factory = new EventFactory(this.debug);

    this.registerLifecycle();

  }

  destroy(): void {

    this.unregisterAll();

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

    const context = this.factory.track(name, properties);

    this.queue.enqueue(context);

  }

  page(
    path?: string,
    properties: Record<string, unknown> = {}
  ): void {

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

  /**
   * Automatically flush when page is hidden.
   */
  private registerLifecycle(): void {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        void this.flush();
      }
    });

    window.addEventListener("beforeunload", () => {
      void this.flush();
    });
  }
}
