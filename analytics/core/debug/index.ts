/**
 * Public surface of the debug layer.
 *
 * `DebugEvent` and `DebugPlugin` are what a plugin author types
 * `onEvent` against; `CONSOLE_PLUGIN` is the registry key of the
 * built-in, so a host can remove it without spelling the name by
 * hand. `DebugController` itself is not re-exported here — the
 * root barrel already exposes it as `analytics.debug`, and two
 * paths to the same object is one too many.
 *
 * `DebugOptions` is intentionally absent for the same reason: it
 * is re-exported from `core/api/config`, and exporting the same
 * name twice would make the barrel ambiguous.
 */
export type { DebugEvent, DebugFailureReason, PipelineStage } from "./debug-event";
export type { DebugPlugin } from "./debug-controller";
export { CONSOLE_PLUGIN } from "./console-plugin";
