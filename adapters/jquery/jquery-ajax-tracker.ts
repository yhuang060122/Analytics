import { Analytics } from "../../core/api/analytics";

export interface JQueryAjaxSettings {
  url?: string;
  type?: string;
  method?: string;
}

export interface JQueryXHR {
  status: number;
  responseText?: string;
}
declare const $: JQueryStatic;

const START_TIME = "__analytics_started";

export class JQueryAjaxTracker {
  constructor(private readonly analytics: Analytics) {}

  private shouldIgnore(url: string): boolean {
    return url.includes("/api/analytics/events");
  }

  /**
   * Enable automatic tracking of every $.ajax call.
   */
  start(): void {
    // Request started
    $(document).ajaxSend(
      (_event, jqXHR: JQueryXHR, settings: JQueryAjaxSettings) => {
        (jqXHR as any)[START_TIME] = performance.now();
      },
    );

    // Success
    $(document).ajaxSuccess(
      (_event, jqXHR: JQueryXHR, settings: JQueryAjaxSettings) => {
        if (this.shouldIgnore(settings.url ?? "")) {
          return;
        }

        this.analytics.track(
          "API Request",
          this.buildProperties(jqXHR, settings),
        );
      },
    );

    // Error
    $(document).ajaxError(
      (_event, jqXHR: JQueryXHR, settings: JQueryAjaxSettings) => {
        if (this.shouldIgnore(settings.url ?? "")) {
          return;
        }

        this.analytics.track(
          "API Error",
          this.buildProperties(jqXHR, settings),
        );
      },
    );
  }

  private buildProperties(
    jqXHR: JQueryXHR,
    settings: JQueryAjaxSettings,
  ): Record<string, unknown> {
    const started = (jqXHR as any)[START_TIME] ?? performance.now();

    return {
      method: settings.method ?? settings.type ?? "GET",

      url: settings.url ?? "",

      status: jqXHR.status,

      durationMs: Math.round(performance.now() - started),

      pagePath: window.location.pathname,

      pageUrl: window.location.href,

      pageTitle: document.title,
    };
  }
}
