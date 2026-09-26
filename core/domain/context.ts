import type { AnalyticsEvent } from "./event";

export interface AnalyticsContext {
  readonly sessionId: string;

  readonly url: string;

  readonly referrer: string | null;

  readonly userAgent: string;

  readonly event: AnalyticsEvent;
}