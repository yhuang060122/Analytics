import type { EventRecorder, Tracker } from "../../core/api/tracker";
import {
  NetworkTrackerCore,
  type NetworkTrackerOptions,
} from "../network/network-core";

export interface FetchTrackerOptions extends NetworkTrackerOptions {
  /**
   * URLs that should not be tracked.
   * Example:
   * ["/internal/health"]
   *
   * Merged with the built-in ignore list, never replaces it.
   */
  ignoreUrls?: string[];
}

export class FetchTracker implements Tracker {
  private originalFetch?: typeof window.fetch;

  private readonly core: NetworkTrackerCore;

  constructor(
    recorder: EventRecorder,
    options: FetchTrackerOptions = {},
  ) {
    this.core = new NetworkTrackerCore(recorder, {
      transport: "fetch",
      ...options,
    });
  }

  start(): void {
    if (this.originalFetch) {
      return;
    }

    // bind(): a detached window.fetch call throws
    // "Illegal invocation" in browsers.
    this.originalFetch = window.fetch.bind(window);

    window.fetch = this.interceptFetch;
  }

  stop(): void {
    if (!this.originalFetch) {
      return;
    }

    window.fetch = this.originalFetch;
    this.originalFetch = undefined;
  }

  private interceptFetch: typeof window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);

    const url = request.url;

    if (this.core.shouldIgnore(url)) {
      return this.originalFetch!(request);
    }

    const method = request.method;
    const started = performance.now();

    try {
      const response = await this.originalFetch!(request);

      this.core.record({
        method,
        url,
        status: response.status,
        durationMs: performance.now() - started,
      });

      return response;
    } catch (error) {
      this.core.recordError({
        method,
        url,
        status: 0,
        durationMs: performance.now() - started,
      });

      throw error;
    }
  };
}
