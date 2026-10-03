import type { AnalyticsEvent } from "./event";

export interface AnalyticsContext {
  /**
   * The host's correlation id, or null when it has not written
   * one.
   *
   * Nullable rather than empty-string-or-missing, and the key is
   * always present: a collector must be able to tell "the host
   * sent no id" from "this SDK version has no id field", and must
   * not have every id-less visit collapse into one group.
   *
   * This is not a client-minted value. See `readSessionId()`.
   */
  readonly sessionId: string | null;

  readonly url: string;

  readonly referrer: string | null;

  readonly userAgent: string;

  readonly event: AnalyticsEvent;
}