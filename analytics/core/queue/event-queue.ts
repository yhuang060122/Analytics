import type { AnalyticsContext } from "../domain";
import type { DebugController } from "../debug/debug-controller";
import type { Destination } from "../transport/destination";

export interface EventQueueOptions {
  batchSize?: number;
  flushInterval?: number;

  /**
   * How many times a failing batch is retried before it is
   * dropped. 0 means "one attempt, then drop".
   */
  maxRetries?: number;

  /**
   * Base delay before the first retry. Each further retry
   * doubles it, capped at MAX_RETRY_DELAY.
   */
  retryDelay?: number;

  /**
   * Hard cap on buffered events. When the queue is full the
   * oldest event is dropped, so a long outage can never grow
   * the buffer without bound.
   */
  maxQueueSize?: number;
}

const DEFAULT_OPTIONS: Required<EventQueueOptions> = {
  batchSize: 20,
  flushInterval: 1000,
  maxRetries: 3,
  retryDelay: 1000,
  maxQueueSize: 500,
};

const MAX_RETRY_DELAY = 30_000;

export class EventQueue {

  private readonly queue: AnalyticsContext[] = [];

  private readonly options: Required<EventQueueOptions>;

  private readonly destination: Destination;

  private readonly debug: DebugController;

  private flushing = false;

  private timer?: number;

  private retryTimer?: number;

  private failures = 0;

  private autoFlush = true;

  constructor(
    destination: Destination,
    debug: DebugController,
    options: EventQueueOptions = {}
  ) {
    this.destination = destination;
    this.debug = debug;

    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    // A dead network is the normal cause of a failed batch,
    // so recovering connectivity is worth a retry right away
    // instead of waiting out the backoff.
    window.addEventListener("online", this.handleOnline);
  }

  enqueue(context: AnalyticsContext): void {

    if (this.queue.length >= this.options.maxQueueSize) {
      const dropped = this.queue.shift() as AnalyticsContext;

      // Debug → FAILED (terminal: it never even left)
      this.debug.emit({
        stage: "failed",
        context: dropped,
        timestamp: Date.now(),
        reason: "queue-overflow",
        error: "queue overflow",
      });
    }

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

  /**
   * Ship everything buffered.
   *
   * Never rejects: a rejected `flush()` used to surface as an
   * unhandled rejection, because every automatic caller does
   * `void this.flush()`.
   *
   * Events are removed from the buffer only once the
   * destination accepted them, so a failed batch stays queued
   * and is retried with a backoff instead of being lost.
   */
  async flush(): Promise<void> {

    if (this.flushing) return;
    if (this.queue.length === 0) return;

    this.flushing = true;
    this.clearTimer();
    this.clearRetryTimer();

    try {

      while (this.queue.length > 0) {

        // Peek, do not splice: the batch is only removed after
        // a successful send.
        const batch = this.queue.slice(
          0,
          this.options.batchSize
        );

        let error: unknown;

        try {

          // Debug → FLUSHING
          batch.forEach(ctx =>
            this.debug.emit({
              stage: "flushing",
              context: ctx,
              timestamp: Date.now(),
            })
          );

          await this.destination.send(batch);

        } catch (caught) {
          error = caught;
        }

        if (!error) {
          this.queue.splice(0, batch.length);
          this.failures = 0;
          continue;
        }

        // The batch stays queued. Give up only once the retry
        // budget is spent, so a short outage is survivable and
        // a permanent one does not retry forever.
        if (this.failures >= this.options.maxRetries) {
          this.drop(batch, error);
          this.failures = 0;
          continue;
        }

        this.failures += 1;
        this.scheduleRetry();
        break;

      }

    } finally {
      this.flushing = false;
    }

  }

  /**
   * Stop scheduling automatic flushes. An explicit `flush()`
   * still works, which is what `destroy()` relies on to make
   * a last attempt.
   */
  stop(): void {

    this.autoFlush = false;
    this.clearTimer();
    this.clearRetryTimer();

    window.removeEventListener("online", this.handleOnline);

  }

  clear(): void {
    this.queue.length = 0;
    this.failures = 0;
    this.clearTimer();
    this.clearRetryTimer();
  }

  get size(): number {
    return this.queue.length;
  }

  get retrying(): boolean {
    return this.retryTimer !== undefined;
  }

  private drop(
    batch: readonly AnalyticsContext[],
    error: unknown
  ): void {

    this.queue.splice(0, batch.length);

    batch.forEach(ctx =>
      this.debug.emit({
        stage: "failed",
        context: ctx,
        timestamp: Date.now(),
        reason: "undeliverable",
        error: `dropped after ${this.options.maxRetries + 1} attempts: ${String(error)}`,
      })
    );

  }

  private scheduleFlush(): void {

    if (!this.autoFlush) return;
    if (this.timer) return;

    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.options.flushInterval);

  }

  private scheduleRetry(): void {

    if (!this.autoFlush) return;
    if (this.retryTimer) return;

    const delay = Math.min(
      this.options.retryDelay * 2 ** (this.failures - 1),
      MAX_RETRY_DELAY
    );

    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      void this.flush();
    }, delay);

  }

  private clearTimer(): void {

    if (!this.timer) return;

    clearTimeout(this.timer);
    this.timer = undefined;

  }

  private clearRetryTimer(): void {

    if (!this.retryTimer) return;

    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;

  }

  private readonly handleOnline = (): void => {
    void this.flush();
  };

}
