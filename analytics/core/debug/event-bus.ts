import { warnOnce } from "../warn";
import type { DebugEvent } from "./debug-event";

type Listener = (event: DebugEvent) => void;

export interface SubscribeOptions {

  /**
   * Called when the bus drops the listener for failing too
   * often.
   *
   * Without it the owner would keep advertising a subscriber
   * that receives nothing, which is a worse bug than the
   * throwing plugin was.
   */
  onDrop?: () => void;
}

/**
 * How many failures in a row earn a listener its removal.
 *
 * Three, not one: a plugin may well throw on the first event
 * because it is still warming up its own client. Throwing on
 * *every* event is a plugin that is never going to work.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

interface Entry {
  failures: number;
  onDrop?: () => void;
}

export class DebugEventBus {
  private readonly listeners = new Set<Listener>();

  private readonly entries = new WeakMap<Listener, Entry>();

  /**
   * Deliver one event to everyone watching.
   *
   * Each listener gets its own try/catch. The bus used to run
   * them bare, so one broken plugin propagated out of `emit()`,
   * through `DebugController`, `EventFactory` and finally into
   * the host application's own click handler — running analytics
   * could break the thing being analysed. Observers are exactly
   * the layer where a failure may be swallowed, because nobody
   * downstream depends on them.
   */
  emit(event: DebugEvent): void {

    // Snapshot: removing a failing listener below mutates the
    // set while this loop is running.
    for (const listener of [...this.listeners]) {

      try {

        listener(event);

        const entry = this.entries.get(listener);

        if (entry) entry.failures = 0;

      } catch (error) {

        this.failed(listener, error);

      }

    }

  }

  subscribe(
    listener: Listener,
    options: SubscribeOptions = {},
  ): () => void {

    this.listeners.add(listener);

    this.entries.set(listener, {
      failures: 0,
      onDrop: options.onDrop,
    });

    return () => this.unsubscribe(listener);
  }

  private unsubscribe(listener: Listener): void {
    this.listeners.delete(listener);
    this.entries.delete(listener);
  }

  private failed(listener: Listener, error: unknown): void {

    const entry = this.entries.get(listener) ?? { failures: 0 };

    entry.failures += 1;

    if (entry.failures < MAX_CONSECUTIVE_FAILURES) {

      this.entries.set(listener, entry);

      warnOnce(
        "plugin-threw",
        "a debug plugin threw while handling an event; " +
          `the SDK carried on (${String(error)})`,
      );

      return;

    }

    const { onDrop } = entry;

    this.unsubscribe(listener);

    warnOnce(
      "plugin-disabled",
      `a debug plugin failed ${entry.failures} times in a row and was ` +
        `unsubscribed (${String(error)})`,
    );

    // Last, so the owner sees itself already detached.
    onDrop?.();

  }
}
