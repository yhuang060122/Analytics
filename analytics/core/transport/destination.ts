import type { AnalyticsContext } from "../domain";

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
  send(events: readonly AnalyticsContext[]): Promise<void>;
}
