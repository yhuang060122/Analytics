// core/dom.ts

/**
 * Whether there is a DOM to attach to.
 *
 * `new Analytics()` used to reach for `document` and `window`
 * in its constructor without looking, which means a server
 * render that merely constructs the SDK throws.
 *
 * It is now also the only thing that gates *recording*: the
 * event factory used to reach for `window.location` through a
 * default parameter, so `analytics.page()` threw on a server
 * and the event was dropped with a process-wide `warnOnce` —
 * every render after the first failing the same way silently.
 * Recording reads the page context through a reader that
 * degrades instead, so an event produced without a browser
 * carries empty `url` / `userAgent` and is visibly incomplete
 * rather than absent. Probes still need this to decide whether
 * there is anything to attach to.
 */
export function hasDom(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined";
}
