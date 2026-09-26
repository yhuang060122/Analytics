import type { EventRecorder, Tracker } from "../../core/api/tracker";

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

type AjaxHandler = (
  event: unknown,
  jqXHR: JQueryXHR,
  settings: JQueryAjaxSettings,
) => void;

export class JQueryAjaxTracker implements Tracker {

  private readonly recorder: EventRecorder;

  private running = false;

  private readonly handlers: Array<[string, AjaxHandler]> = [];

  constructor(recorder: EventRecorder) {
    this.recorder = recorder;
  }

  private shouldIgnore(url: string): boolean {
    return url.includes("/api/analytics/events");
  }

  /**
   * Enable automatic tracking of every $.ajax call.
   */
  start(): void {

    if (this.running) return;

    this.running = true;

    const onSend: AjaxHandler = (_event, jqXHR) => {

      (jqXHR as unknown as Record<string, unknown>)[START_TIME] =
        performance.now();

    };

    const onSuccess: AjaxHandler = (_event, jqXHR, settings) => {

      if (this.shouldIgnore(settings.url ?? "")) {
        return;
      }

      this.recorder.track(
        "API Request",
        this.buildProperties(jqXHR, settings),
      );

    };

    const onError: AjaxHandler = (_event, jqXHR, settings) => {

      if (this.shouldIgnore(settings.url ?? "")) {
        return;
      }

      this.recorder.track(
        "API Error",
        this.buildProperties(jqXHR, settings),
      );

    };

    $(document).ajaxSend(onSend);
    $(document).ajaxSuccess(onSuccess);
    $(document).ajaxError(onError);

    this.handlers.push(
      ["ajaxSend", onSend],
      ["ajaxSuccess", onSuccess],
      ["ajaxError", onError],
    );

  }

  stop(): void {

    if (!this.running) return;

    this.running = false;

    this.handlers.forEach(([event, handler]) => {
      $(document).off(event, handler);
    });

    this.handlers.length = 0;

  }

  private buildProperties(
    jqXHR: JQueryXHR,
    settings: JQueryAjaxSettings,
  ): Record<string, unknown> {

    const started =
      (jqXHR as unknown as Record<string, number>)[START_TIME] ??
      performance.now();

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
