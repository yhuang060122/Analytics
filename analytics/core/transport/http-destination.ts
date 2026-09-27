import type { AnalyticsContext } from "../domain";
import type { DebugController } from "../debug/debug-controller";
import type { DebugFailureReason } from "../debug/debug-event";
import type { Destination, SendOptions } from "./destination";

export interface HttpDestinationOptions {
  endpoint: string;
  apiKey?: string;
  headers?: Record<string, string>;

  /**
   * How long a batch may be in flight before it is abandoned.
   * Defaults to 10s. `0` disables the timeout.
   *
   * A request that never settles is the worst failure mode
   * there is: nothing is retryable, nothing is reported, and
   * the queue waits forever on a promise that will never come
   * back. A black-holed route and a captive portal both produce
   * exactly that, surprisingly often.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Bodies larger than this cannot ride on keepalive.
 *
 * Chrome refuses them outright with a TypeError, so retrying
 * with the same flag would fail identically forever. The limit
 * is a budget of its own, well under the documented 64KB.
 */
const KEEPALIVE_BODY_LIMIT = 60_000;

/** `keepalive` gates on bytes, and bodies are usually UTF-8. */
function byteLength(body: string): number {

  if (typeof TextEncoder === "undefined") return body.length;

  return new TextEncoder().encode(body).length;

}

export class HttpDestination implements Destination {

  private readonly options: HttpDestinationOptions;

  private readonly debug: DebugController;

  constructor(
    options: HttpDestinationOptions,
    debug: DebugController
  ) {
    this.options = options;
    this.debug = debug;
  }

  async send(
    events: readonly AnalyticsContext[],
    options: SendOptions = {},
  ): Promise<void> {

    if (events.length === 0) return;

    const body = JSON.stringify({ events });

    const keepalive = this.allowKeepalive(
      body,
      options.keepalive === true
    );

    const started = performance.now();

    // Set by the abort timer below, read once the request has
    // settled: it is what tells "timed out" apart from every
    // other way a fetch can reject.
    let timedOut = false;

    try {

      const response = await this.post(
        body,
        keepalive,
        () => (timedOut = true)
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const duration = Math.round(
        performance.now() - started
      );

      // Debug → SENT
      events.forEach(ctx =>
        this.debug.emit({
          stage: "sent",
          context: ctx,
          timestamp: Date.now(),
          durationMs: duration,
        })
      );

    } catch (error) {

      const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      const failure: {
        reason: DebugFailureReason;
        message: string;
      } = timedOut
        ? {
            reason: "timeout",
            message: `no response after ${timeoutMs} ms`,
          }
        : {
            reason: "transport-error",
            message: String(error),
          };

      // Debug → FAILED
      events.forEach(ctx =>
        this.debug.emit({
          stage: "failed",
          context: ctx,
          timestamp: Date.now(),
          reason: failure.reason,
          error: failure.message,
        })
      );

      // Either way it counts as a failed attempt, which is what
      // makes the queue's retry budget meaningful.
      throw timedOut ? new Error(failure.message) : error;

    }

  }

  private buildHeaders(): HeadersInit {

    return {
      "Content-Type": "application/json",

      ...(this.options.apiKey && {
        "X-API-Key": this.options.apiKey,
      }),

      ...this.options.headers,
    };

  }

  private buildInit(body: string, keepalive: boolean): RequestInit {

    return {
      method: "POST",
      headers: this.buildHeaders(),
      body,
      keepalive,
    };

  }

  /**
   * Whether this request may outlive the page.
   *
   * Asked for rarely (the unload flush only) and granted rarely:
   * an oversized body is refused outright, so it would rather
   * go through without the flag than not at all.
   */
  private allowKeepalive(
    body: string,
    requested: boolean
  ): boolean {

    if (!requested) return false;

    return byteLength(body) <= KEEPALIVE_BODY_LIMIT;

  }

  private async post(
    body: string,
    keepalive: boolean,
    onTimeout: () => void
  ): Promise<Response> {

    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const init = this.buildInit(body, keepalive);

    // A runtime without AbortController has nothing to arm, so
    // the request runs unbounded there — better than not being
    // able to send at all.
    if (typeof AbortController === "undefined" || timeoutMs <= 0) {
      return fetch(this.options.endpoint, init);
    }

    const controller = new AbortController();

    const timer = setTimeout(() => {
      onTimeout();
      controller.abort();
    }, timeoutMs);

    try {

      return await fetch(this.options.endpoint, {
        ...init,
        signal: controller.signal,
      });

    } finally {

      clearTimeout(timer);

    }

  }

}
