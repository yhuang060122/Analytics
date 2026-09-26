// adapters/network/active-recorder.ts

import type { EventRecorder } from "../../core/api/tracker";

/**
 * Slot holding the recorder created by `init()`.
 *
 * Exists for the script-tag flow: an app that loads the SDK
 * as a plain <script> cannot call `init()` and pass the result
 * into a framework provider, so the framework adapter reads
 * the recorder back out of here.
 *
 * Leaf module on purpose — nothing imports it from above,
 * so adapters can use it without creating a cycle.
 */
let active: EventRecorder | undefined;

export function setActiveRecorder(recorder: EventRecorder): void {
  active = recorder;
}

export function getActiveRecorder(): EventRecorder | undefined {
  return active;
}

export function clearActiveRecorder(): void {
  active = undefined;
}
