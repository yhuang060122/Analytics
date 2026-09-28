/**
 * Which DOM probes to wire.
 *
 * Network tracking is deliberately absent: it is a second,
 * overlapping switch (`network.fetch` / `frameworks.*`) that
 * `init()` and `registerDetectedAdapters()` own.
 *
 * `autoTrack` is only a *config alias* — the actual wiring is
 * done by the click/page adapters in the registry, resolved by
 * `planFor()` in the composition root. There is no helper to
 * bundle the two probes anymore: register them directly and
 * start each one yourself.
 */
export interface AutoTrackOptions {
  page?: boolean;
  click?: boolean;
}
