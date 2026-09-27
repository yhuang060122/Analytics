// core/dom.ts

/**
 * Whether there is a DOM to attach to.
 *
 * `new Analytics()` used to reach for `document` and `window`
 * in its constructor without looking, which means a server
 * render that merely constructs the SDK throws. The SDK still
 * needs a browser to *record* anything — the event factory
 * reads `window.location` — but constructing it, and
 * destroying it again, must be safe anywhere.
 */
export function hasDom(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined";
}
