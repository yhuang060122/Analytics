import { AutoTrackManager } from "../../adapters/browser/auto-track";
import { DebugController } from "../debug/debug-controller";
import { EventFactory } from "../factory";
import { EventQueue } from "../queue";
import { HttpDestination } from "../transport";
import { AnalyticsConfig } from "./config";

export class Analytics {

  private readonly autoTrack?: AutoTrackManager;

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

    if (config.autoTrack) {

      this.autoTrack = new AutoTrackManager(
        this,
        config.autoTrack
      );

      this.autoTrack.start();

    }

    this.registerLifecycle();

  }

  destroy(): void {

    this.autoTrack?.stop();

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
