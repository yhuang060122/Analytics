import type { EventRecorder, Tracker } from "../../core/api/tracker";

export interface FetchTrackerOptions {
  /**
   * URLs that should not be tracked.
   * Example:
   * ["/api/analytics/events"]
   */
  ignoreUrls?: string[];
}

export class FetchTracker implements Tracker {
  private originalFetch?: typeof window.fetch;

  private readonly ignoreUrls: string[];

  private readonly recorder: EventRecorder;

  constructor(
    recorder: EventRecorder,
    options: FetchTrackerOptions = {},
  ) {
    this.recorder = recorder;
    this.ignoreUrls = options.ignoreUrls ?? ["/api/analytics/events"];
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

    if (this.shouldIgnore(url)) {
      return this.originalFetch!(request);
    }

    const method = request.method;
    const started = performance.now();

    try {
      const response = await this.originalFetch!(request);

      this.recorder.track("API Request", {
        method,
        url: this.normalizeUrl(url),
        status: response.status,
        durationMs: Math.round(performance.now() - started),

        pagePath: window.location.pathname,
        pageUrl: window.location.href,
        pageTitle: document.title,
      });

      return response;
    } catch (error) {
      this.recorder.track("API Error", {
        method,
        url: this.normalizeUrl(url),
        status: 0,
        durationMs: Math.round(performance.now() - started),

        pagePath: window.location.pathname,
        pageUrl: window.location.href,
        pageTitle: document.title,
      });

      throw error;
    }
  };

  private shouldIgnore(url: string): boolean {
    return this.ignoreUrls.some((x) => url.includes(x));
  }

  /**
   * Convert absolute URL into relative path.
   */
  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch {
      return url;
    }
  }
}
