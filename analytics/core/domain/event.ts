export type AnalyticsEventType = "track" | "page";

export interface AnalyticsEvent {

  /**
   * No `id`.
   *
   * Every event used to carry a client-generated UUID, on the
   * reasoning that a retrying queue needs one for the server to
   * de-duplicate on. The retry went in an earlier round, and
   * with it went the only thing in this SDK that would ever
   * have read an id: nothing de-duplicates, nothing
   * correlates, no log line mentions it. It was serialised into
   * every batch so the collector could attach a primary key the
   * collector was going to assign anyway.
   *
   * `sessionId` on the context is a different question and
   * stays: it groups the events of one visit, which the server
   * cannot work out on its own. It is read from what the host
   * wrote, not minted here — see `readSessionId()`.
   */
  readonly type: AnalyticsEventType;

  /**
   * Track → event name
   * Page  → page path
   */
  readonly name: string;

  readonly properties: Readonly<Record<string, unknown>>;

  readonly timestamp: string;
}
