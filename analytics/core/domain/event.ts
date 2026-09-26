export type AnalyticsEventType = "track" | "page";

export interface AnalyticsEvent {
  readonly id: string;

  readonly type: AnalyticsEventType;

  /**
   * Track → event name
   * Page  → page path
   */
  readonly name: string;

  readonly properties: Readonly<Record<string, unknown>>;

  readonly timestamp: string;
}