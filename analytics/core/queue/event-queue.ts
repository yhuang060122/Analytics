import { hasDom } from "../dom";
import type { AnalyticsContext } from "../domain";
import type { DebugController } from "../debug/debug-controller";
import type { Destination } from "../transport/destination";

export interface EventQueueOptions {
  batchSize?: number;
  flushInterval?: number;
}

/**
 * Options for a single flush.
 *
 * Only the flush that runs while the page is being unloaded (or
 * hidden) sets this, which is why it is an argument rather than
 * constructor state — see `Destination.send`.
 */
export interface FlushOptions {
  keepalive?: boolean;
}

const DEFAULT_OPTIONS: Required<EventQueueOptions> = {
  batchSize: 20,
  flushInterval: 1000,
};

/**
 * Hard cap on buffered events. When the queue is full the
 * oldest event is dropped, so an endpoint that stays down
 * cannot grow the buffer without bound.
 *
 * Not configurable, and that is a decision rather than an
 * oversight: no caller ever set it, a cap you cannot raise is
 * a cap you cannot hit by accident, and a host that genuinely
 * needs a bigger buffer needs something other than a longer
 * queue (it needs this SDK to retry, which it deliberately
 * does not do — see the drop path in `drain()`).
 */
const MAX_BUFFERED_EVENTS = 500;

export class EventQueue {

  private readonly queue: AnalyticsContext[] = [];

  private readonly options: Required<EventQueueOptions>;

  private readonly destination: Destination;

  private readonly debug: DebugController;

  /**
   * The flush currently running, if any.
   *
   * Kept as the promise rather than a boolean so a concurrent
   * `flush()` can hand it back instead of resolving at once:
   * `await flush()` and `close()` mean "the buffer has been
   * dealt with when this settles", and returning undefined
   * while another flush owned the buffer made that a lie.
   */
  private inFlight?: Promise<void>;

  private timer?: number;

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

    // A page that was offline buffered events nobody could
    // ship. Regaining connectivity is a good moment to try,
    // and unlike a failed batch this is a fresh attempt at
    // events that have never been sent.
    if (hasDom()) {
      window.addEventListener("online", this.handleOnline);
    }
  }

  enqueue(context: AnalyticsContext): void {

    if (this.queue.length >= MAX_BUFFERED_EVENTS) {
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
   * A batch is removed only once the destination accepted it.
   * A batch the destination refused is dropped, and reported
   * as `FAILED · undeliverable` — there is no retry, so it is
   * reported rather than silently absorbed.
   *
   * A flush already in progress owns the buffer: a second call
   * returns that same promise instead of resolving at once, so
   * `await flush()` only settles once the buffer has actually
   * been dealt with. Its options win as well — `keepalive`
   * cannot be retro-fitted onto a request already gone.
   */
  flush(options?: FlushOptions): Promise<void> {

    if (this.inFlight) return this.inFlight;

    if (this.queue.length === 0) return Promise.resolve();

    const run = this.drain(options).finally(() => {
      this.inFlight = undefined;
    });

    this.inFlight = run;

    return run;

  }

  private async drain(options?: FlushOptions): Promise<void> {

    this.clearTimer();

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

        await this.destination.send(batch, options);

      } catch (caught) {
        error = caught;
      }

      if (!error) {
        this.queue.splice(0, batch.length);
        continue;
      }

      // No retry budget: a batch that could not be delivered
      // is reported and dropped. The alternative — holding it
      // for a later attempt — means a permanently refused
      // endpoint grows the buffer and every subsequent flush
      // re-sends the same doomed batch, which is the shape of
      // a bug report, not of resilience.
      this.drop(batch, error);

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

    if (hasDom()) {
      window.removeEventListener("online", this.handleOnline);
    }

  }

  get size(): number {
    return this.queue.length;
  }

  private drop(
    batch: readonly AnalyticsContext[],
    error: unknown
  ): void {

    this.queue.splice(0, batch.length);

    // Loud on purpose: with no retry, this event is simply
    // gone. Whoever reads the pipeline has to be able to see
    // that it went missing and why.
    batch.forEach(ctx =>
      this.debug.emit({
        stage: "failed",
        context: ctx,
        timestamp: Date.now(),
        reason: "undeliverable",
        error: `dropped after one attempt: ${String(error)}`,
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

  private clearTimer(): void {

    if (!this.timer) return;

    clearTimeout(this.timer);
    this.timer = undefined;

  }

  private readonly handleOnline = (): void => {
    void this.flush();
  };

}
