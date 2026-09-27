import type { AnalyticsContext } from "../domain";
import type { DebugController } from "../debug/debug-controller";
import type { Destination } from "./destination";

export interface HttpDestinationOptions {
  endpoint: string;
  apiKey?: string;
  headers?: Record<string, string>;
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
    events: readonly AnalyticsContext[]
  ): Promise<void> {

    if (events.length === 0) return;

    const started = performance.now();

    try {

      const response = await fetch(
        this.options.endpoint,
        {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify({ events }),
          keepalive: true,
        }
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

      // Debug → FAILED
      events.forEach(ctx =>
        this.debug.emit({
          stage: "failed",
          context: ctx,
          timestamp: Date.now(),
          error: String(error),
        })
      );

      throw error;

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

}