import { AnalyticsContext } from "../domain";
import { DebugController } from "../debug/debug-controller";
import { Destination } from "./destination";

export interface EventQueueOptions {
  batchSize?: number;
  flushInterval?: number;
}

const DEFAULT_OPTIONS: Required<EventQueueOptions> = {
  batchSize: 20,
  flushInterval: 1000,
};

export class EventQueue {

  private readonly queue: AnalyticsContext[] = [];

  private readonly options: Required<EventQueueOptions>;

  private flushing = false;

  private timer?: number;

  constructor(
    private readonly destination: Destination,
    private readonly debug: DebugController,
    options: EventQueueOptions = {}
  ) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  enqueue(context: AnalyticsContext): void {

    this.queue.push(context);

    // Debug → QUEUED
    this.debug.emit({
      stage: "queued",
      context,
      timestamp: Date.now(),
    });

    if (this.queue.length >= this.options.batchSize) {
      void this.flush();
      return;
    }

    this.scheduleFlush();
  }

  async flush(): Promise<void> {

    if (this.flushing) return;
    if (this.queue.length === 0) return;

    this.flushing = true;
    this.clearTimer();

    try {

      while (this.queue.length > 0) {

        const batch = this.queue.splice(
          0,
          this.options.batchSize
        );

        // Debug → FLUSHING
        batch.forEach(ctx =>
          this.debug.emit({
            stage: "flushing",
            context: ctx,
            timestamp: Date.now(),
          })
        );

        await this.destination.send(batch);

      }

    } finally {
      this.flushing = false;
    }

  }

  clear(): void {
    this.queue.length = 0;
    this.clearTimer();
  }

  get size(): number {
    return this.queue.length;
  }

  private scheduleFlush(): void {

    if (this.timer) return;

    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.options.flushInterval);

  }

  private clearTimer(): void {

    if (!this.timer) return;

    clearTimeout(this.timer);
    this.timer = undefined;

  }

}