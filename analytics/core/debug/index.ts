/**
 * Public surface of the debug layer.
 *
 * Exported from the root barrel so a plugin author can type
 * `onEvent(event: DebugEvent)` without reaching into the SDK's
 * internals. `DebugOptions` is intentionally absent: it is
 * already re-exported from `core/api/config`, and exporting the
 * same name twice would make the barrel ambiguous.
 */
export * from "./debug-event";
export * from "./event-bus";
export * from "./plugin";

// Registry keys of the two built-ins, so a host can remove one
// without spelling the name by hand.
export { CONSOLE_PLUGIN } from "./console-plugin";
export { INSPECTOR_PLUGIN } from "./inspector-plugin";
