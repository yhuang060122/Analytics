// core/debug/debug-controller.ts

import type { DebugEvent, PipelineStage } from "./debug-event";

/**
 * One colour per pipeline stage.
 *
 * Typed with `Record<PipelineStage, ...>` so adding a stage to
 * the union fails to compile until a colour exists for it.
 */
const STAGE_COLORS: Record<PipelineStage, string> = {
  created: "#64748B",
  queued: "#F59E0B",
  flushing: "#3B82F6",
  sent: "#22C55E",
  failed: "#EF4444",
};

/**
 * What the pipeline reports about itself.
 *
 * One boolean, because there is one thing it can report *to*.
 * This used to be `{ enabled, console }`, and with a single sink
 * the two flags could only ever be the same value — `console:
 * true, enabled: false` reported nothing, and `enabled: true,
 * console: false` was a host asking for an observer with no way
 * to name it. Two names for one decision is one too many.
 *
 * There is one sink. It used to be one plugin among several,
 * behind a registry: `registerDebugPlugin`, a name, a `stop()`
 * teardown hook, a map to hold them and a bus underneath to
 * isolate a throwing one from the rest. All of that existed to
 * let a second sink in, and there is no second sink — a host
 * that wants events elsewhere wraps `track()`, or reads the
 * console.
 */
export class DebugController {

  private reporting: boolean;

  /**
   * Test-only sink. NOT public API and not reachable from the
   * barrel.
   *
   * The pipeline's `stage` and `reason` exist nowhere else — the
   * console formats them for a human — so the suite has to read
   * them from here. One assignable function rather than a
   * `subscribe()` method on purpose: a method would be an API,
   * an API would need documenting and supporting, and a seam is
   * cheaper than the alternative.
   *
   * It *replaces* the console rather than adding to it. The
   * alternative — both sinks live — would mean every test that
   * wants to read a `reason` also has to swallow the log
   * output, and 37 of them do.
   *
   * Nothing in the SDK assigns it. A host that finds itself
   * wanting to is looking for a second sink, and the honest way
   * to add one is a registry `destroy()` can walk — not this.
   */
  observe: ((event: DebugEvent) => void) | undefined = undefined;

  constructor(reporting = false) {

    this.reporting = reporting;

  }

  emit(event: DebugEvent): void {

    if (!this.reporting) return;

    if (this.observe) {
      this.observe(event);
      return;
    }

    this.log(event);

  }

  /**
   * The one runtime switch: a host that turned debug on to
   * diagnose something can silence it again without rebuilding
   * the SDK.
   */
  console(enable: boolean): void {

    this.reporting = enable;

  }

  /**
   * Stop reporting entirely.
   *
   * It replaces the `teardown()` that used to walk the plugin
   * registry. With one sink there is nothing to unregister, but
   * there is still something to stop: a destroyed instance that
   * kept logging its final flush looked like a live one. Naming
   * it `stop()` puts it next to `queue.stop()` in `destroy()`,
   * which is where it belongs.
   *
   * It also releases the test sink, so an observer closure
   * cannot outlive the instance it was watching.
   */
  stop(): void {

    this.reporting = false;
    this.observe = undefined;

  }

  /**
   * `console.log` with the stage as a coloured label.
   *
   * The reason rides along on the label: a "failed" event
   * without it looks exactly like every other failure, and the
   * reason is the machine-readable half that says which of the
   * four very different endings this is.
   */
  private log(event: DebugEvent): void {

    const label = event.reason
      ? `${event.stage.toUpperCase()} · ${event.reason}`
      : event.stage.toUpperCase();

    console.log(
      `%c${label}`,
      `color:${STAGE_COLORS[event.stage]};font-weight:bold`,
      event.context.event.name,
      event.context.event.properties,
    );

  }

}
