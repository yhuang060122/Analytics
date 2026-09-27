import type { AnalyticsContext } from "../domain";

/**
 * Per-request delivery hints.
 *
 * Separate from the constructor options because one of them is
 * decided per call: only the flush that runs while the page is
 * going away wants `keepalive`.
 */
export interface SendOptions {

  /**
   * Ask to survive the page being unloaded.
   *
   * Off by default on purpose: browsers cap how much may be in
   * flight as keepalive at any one time, so spending the budget
   * on ordinary batches is what makes the last request — the one
   * that cannot be retried — fail.
   */
  keepalive?: boolean;
}

/**
 * The outbound port: where the queue drains to.
 *
 * Lives next to its implementation instead of inside `queue/`,
 * so the dependency runs queue -> transport. It used to sit in
 * `queue/destination.ts`, which forced `transport` to import
 * the whole queue barrel (EventQueue included) just to read an
 * interface.
 */
export interface Destination {
  send(
    events: readonly AnalyticsContext[],
    options?: SendOptions,
  ): Promise<void>;
}
