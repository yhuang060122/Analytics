// core/api/tracker.ts

/**
 * What a probe is allowed to do to the SDK: record events.
 *
 * Probes depend on this interface instead of the concrete
 * Analytics class, which keeps the dependency direction
 * pointing inward: adapters -> core.
 *
 * Not called "Destination": that one already exists and
 * means the opposite end of the pipeline (core -> server).
 * This is the entry point, where events are recorded
 * before the queue ships them.
 */
export interface EventRecorder {

  track(
    name: string,
    properties?: Record<string, unknown>
  ): void;

  page(
    path?: string,
    properties?: Record<string, unknown>
  ): void;

}

/**
 * Lifecycle contract every pluggable probe implements.
 *
 * `start()` must be idempotent: calling it twice must
 * not register the same DOM listener twice.
 */
export interface Tracker {
  start(): void;
  stop(): void;
}

/**
 * How a probe is built when the host wants the wiring to read
 * as configuration.
 *
 * A factory rather than a class, and that is the whole trick:
 * a probe needs the recorder in its constructor, and the
 * recorder is the very object being constructed. Passing
 * `PageTracker` itself would mean the SDK holding a reference
 * to a probe class and looking it up by name — the registry
 * that was deliberately deleted. A function keeps the
 * dependency where it was: the host names the probe, the SDK
 * only calls something that returns a `Tracker`.
 *
 * Which also means options still reach the probe:
 * `recorder => new ClickTracker(recorder, { attribute: "…" })`.
 */
export type ProbeFactory = (recorder: EventRecorder) => Tracker;

/**
 * Base class that makes that idempotency impossible to get
 * wrong.
 *
 * Every probe used to hand-roll `private running = false` plus
 * the two guards, and one of them invented a second idiom with
 * an `originalFetch` sentinel instead. Two probes shipped with
 * the guard missing, which double-registered their listeners.
 *
 * Subclasses implement `onStart()` / `onStop()` and never touch
 * the flag. `canStart()` is the escape hatch for probes whose
 * runtime may simply not exist — `start()` then leaves the
 * tracker stopped rather than half-started.
 */
export abstract class BaseTracker implements Tracker {
  private running = false;

  start(): void {
    if (this.running) return;
    if (!this.canStart()) return;

    this.running = true;
    this.onStart();
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;
    this.onStop();
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Return false to skip starting. The tracker stays stopped,
   * so a later `start()` can still succeed once the runtime
   * appears.
   */
  protected canStart(): boolean {
    return true;
  }

  protected abstract onStart(): void;

  protected abstract onStop(): void;
}
