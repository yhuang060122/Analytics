/**
 * Public surface of the debug layer.
 *
 * There is one sink — the console — and it is not a plugin any
 * more, so there is nothing here to register. What remains is
 * the vocabulary: the stage names a host would match on and the
 * reasons a failure can have, both useful when reading console
 * output or reasoning about what the pipeline reported.
 *
 * `DebugController` is not re-exported: the root barrel already
 * exposes it as `analytics.debug`, and two paths to one object
 * is one too many. There is no options type either — the config
 * is one boolean, so there was nothing for a type to describe.
 */
export type {
  DebugEvent,
  DebugFailureReason,
  PipelineStage,
} from "./debug-event";
