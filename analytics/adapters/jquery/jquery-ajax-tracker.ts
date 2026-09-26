// adapters/jquery/jquery-ajax-tracker.ts

import type { EventRecorder, Tracker } from "../../core/api/tracker";
import type {
  JQueryCollectionLike,
  JQueryLike,
} from "../detect";
import { getJQuery } from "../detect";
import {
  NetworkTrackerCore,
  type NetworkTrackerOptions,
} from "../network/network-core";

export interface JQueryAjaxSettings {
  url?: string;
  type?: string;
  method?: string;
}

export interface JQueryXHR {
  status: number;
  responseText?: string;
}

const START_TIME = "__analytics_started";

type AjaxHandler = (
  event: unknown,
  jqXHR: JQueryXHR,
  settings: JQueryAjaxSettings,
) => void;

/**
 * Tracks every $.ajax call through jQuery's own global ajax
 * events.
 *
 * No `declare const $` anywhere: jQuery is looked up at
 * runtime, so importing this file costs nothing on a page
 * without jQuery and no @types/jquery is forced onto
 * consumers.
 */
export class JQueryAjaxTracker implements Tracker {
  private readonly core: NetworkTrackerCore;

  private running = false;

  private jq?: JQueryLike;

  private readonly handlers: Array<[string, AjaxHandler]> = [];

  constructor(
    recorder: EventRecorder,
    options: NetworkTrackerOptions = {},
  ) {
    this.core = new NetworkTrackerCore(recorder, {
      transport: "jquery",
      ...options,
    });
  }

  /** False when jQuery is missing, so callers can skip quietly. */
  get available(): boolean {
    return getJQuery() !== undefined;
  }

  /**
   * Enable automatic tracking of every $.ajax call.
   *
   * No-ops rather than throws when jQuery is absent: a
   * tracking probe must never break the host page.
   */
  start(): void {
    if (this.running) return;

    const jq = getJQuery();

    if (!jq) return;

    this.jq = jq;
    this.running = true;

    const onSend: AjaxHandler = (_event, jqXHR) => {
      (jqXHR as unknown as Record<string, unknown>)[START_TIME] =
        performance.now();
    };

    const onSuccess: AjaxHandler = (_event, jqXHR, settings) => {
      this.report(jqXHR, settings, false);
    };

    const onError: AjaxHandler = (_event, jqXHR, settings) => {
      this.report(jqXHR, settings, true);
    };

    const doc = this.collection();

    doc.ajaxSend(onSend);
    doc.ajaxSuccess(onSuccess);
    doc.ajaxError(onError);

    this.handlers.push(
      ["ajaxSend", onSend],
      ["ajaxSuccess", onSuccess],
      ["ajaxError", onError],
    );
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;

    const doc = this.collection();

    this.handlers.forEach(([event, handler]) => {
      doc.off(event, handler);
    });

    this.handlers.length = 0;
    this.jq = undefined;
  }

  private collection(): JQueryCollectionLike {
    const jq = this.jq ?? getJQuery();

    if (!jq) {
      throw new Error("[analytics] jQuery vanished between start and use");
    }

    return jq(document) as JQueryCollectionLike;
  }

  private report(
    jqXHR: JQueryXHR,
    settings: JQueryAjaxSettings,
    failed: boolean,
  ): void {
    const url = settings.url ?? "";

    if (this.core.shouldIgnore(url)) {
      return;
    }

    const started =
      (jqXHR as unknown as Record<string, number>)[START_TIME] ??
      performance.now();

    const record = {
      method: settings.method ?? settings.type ?? "GET",
      url,
      status: jqXHR.status ?? 0,
      durationMs: performance.now() - started,
    };

    if (failed) {
      this.core.recordError(record);
      return;
    }

    this.core.record(record);
  }
}
