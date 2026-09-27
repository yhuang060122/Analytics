import { BaseTracker } from "../../core/api/tracker";
import type { EventRecorder } from "../../core/api/tracker";
import type { AnalyticsPlugin } from "../../core/api/plugin";
import { isFetchAvailable } from "../detect";
import {
  NetworkTrackerCore,
  type NetworkTrackerOptions,
} from "../network/network-core";

export class FetchTracker extends BaseTracker {
  private originalFetch?: typeof window.fetch;

  private readonly core: NetworkTrackerCore;

  constructor(
    recorder: EventRecorder,
    options: NetworkTrackerOptions = {},
  ) {
    super();

    this.core = new NetworkTrackerCore(recorder, {
      transport: "fetch",
      ...options,
    });
  }

  protected onStart(): void {
    // Store the raw reference, not a bound copy: restoring a
    // bound function would change window.fetch's identity,
    // which breaks any other library that also wraps it.
    this.originalFetch = window.fetch;

    window.fetch = this.interceptFetch;
  }

  protected onStop(): void {
    if (!this.originalFetch) {
      return;
    }

    window.fetch = this.originalFetch;
    this.originalFetch = undefined;
  }

  /**
   * `call(window, ...)` instead of a stored bound copy: a
   * detached fetch throws "Illegal invocation" in browsers.
   */
  private callOriginal(
    request: Request,
  ): ReturnType<typeof window.fetch> {
    return this.originalFetch!.call(window, request);
  }

  private interceptFetch: typeof window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);

    const url = request.url;

    if (this.core.shouldIgnore(url)) {
      return this.callOriginal(request);
    }

    const method = request.method;
    const started = performance.now();

    try {
      const response = await this.callOriginal(request);

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

/**
 * The registry descriptor for this probe.
 *
 * `available()` reads `globalThis.fetch`, so an old browser or
 * a server simply reports `unavailable` instead of having the
 * probe patch a function that is not there.
 */
export const fetchAdapter: AnalyticsPlugin<NetworkTrackerOptions> = {
  name: "fetch",
  available: () => isFetchAvailable(),
  start(host, options) {
    const tracker = new FetchTracker(host, options);
    tracker.start();
    host.registerTracker(tracker);
  },
};
