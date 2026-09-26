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
