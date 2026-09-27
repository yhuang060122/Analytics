// adapters/network/network-core.ts

import type { EventRecorder } from "../../core/api/tracker";

/**
 * Which technology produced the request.
 *
 * Answering the "how do I tell API calls apart?" question:
 * every transport emits the same two event names and tags
 * itself, so queries can filter on `transport` instead of
 * on three different event names.
 *
 * Only what an adapter actually produces. `xhr` was never
 * assigned by anything (jQuery goes through `$.ajax`, and there
 * is no XHR adapter), so it was a union member no value could
 * ever have.
 */
export type NetworkTransport =
  | "fetch"
  | "jquery"
  | "angular"
  | "unknown";

export interface NetworkRecord {
  method: string;
  url: string;
  status: number;
  durationMs: number;
}

/**
 * Event naming is deliberately absent here.
 *
 * `successEventName` / `errorEventName` used to exist, and
 * nothing ever set them — but their presence implied that one
 * transport may name its events differently, which is exactly
 * what this module exists to prevent. Per-transport naming now
 * lives nowhere; filter on `properties.transport` instead.
 */
export interface NetworkTrackerOptions {
  /**
   * Added to the built-in ignore list, never replaces it.
   * The SDK's own endpoint must always stay ignored or the
   * tracker starts reporting its own reports.
   */
  ignoreUrls?: string[];

  transport?: NetworkTransport;

  /** Override for apps using hash routing or a base href. */
  normalizeUrl?: (url: string) => string;
}

export const NETWORK_SUCCESS_EVENT = "API Request";
export const NETWORK_ERROR_EVENT = "API Error";

/**
 * Never reported. Kept as a constant because a user who
 * overrides `ignoreUrls` must not be able to silence it.
 */
export const DEFAULT_IGNORE_URLS: readonly string[] = [
  "/api/analytics/events",
];

export interface PageContext {
  pagePath: string;
  pageUrl: string;
  pageTitle: string;
}

/**
 * Reads the page context without assuming a browser.
 * Returns empty strings during SSR so a server render
 * never throws and never ships a fake URL.
 */
export function readPageContext(): PageContext {
  const scope = typeof globalThis !== "undefined" ? globalThis : undefined;

  const location = (scope as { location?: Location } | undefined)?.location;
  const doc = (scope as { document?: Document } | undefined)?.document;

  return {
    pagePath: location?.pathname ?? "",
    pageUrl: location?.href ?? "",
    pageTitle: doc?.title ?? "",
  };
}

/**
 * Framework-agnostic half of every network adapter.
 *
 * Owns the three things all transports used to duplicate:
 * event naming, property shape, and the ignore rule.
 * Adapters only translate their own lifecycle into
 * `record()` calls.
 */
export class NetworkTrackerCore {
  private readonly recorder: EventRecorder;

  private readonly options: NetworkTrackerOptions;

  private readonly ignoreUrls: string[];

  constructor(
    recorder: EventRecorder,
    options: NetworkTrackerOptions = {},
  ) {
    this.recorder = recorder;
    this.options = options;

    this.ignoreUrls = [
      ...DEFAULT_IGNORE_URLS,
      ...(options.ignoreUrls ?? []),
    ];
  }

  get transport(): NetworkTransport {
    return this.options.transport ?? "unknown";
  }

  /**
   * True for requests the SDK must never record: its own
   * endpoint first and foremost.
   */
  shouldIgnore(url: string): boolean {
    if (!url) return true;

    return this.ignoreUrls.some(fragment => url.includes(fragment));
  }

  /**
   * Absolute URL to a stable relative path, so the same
   * endpoint does not fragment into dozens of event
   * variants across environments.
   */
  normalizeUrl(url: string): string {
    if (this.options.normalizeUrl) {
      return this.options.normalizeUrl(url);
    }

    try {
      const parsed = new URL(url, readPageContext().pageUrl || undefined);
      return parsed.pathname + parsed.search;
    } catch {
      return url;
    }
  }

  /**
   * Success or error is decided by status, so all three
   * transports classify identically.
   */
  record(record: NetworkRecord): void {
    const failed = record.status === 0 || record.status >= 400;

    if (failed) {
      this.recordError(record);
      return;
    }

    this.recordSuccess(record);
  }

  recordSuccess(record: NetworkRecord): void {
    this.emit(NETWORK_SUCCESS_EVENT, record);
  }

  recordError(record: NetworkRecord): void {
    this.emit(NETWORK_ERROR_EVENT, record);
  }

  /**
   * Shared property shape. Every transport sends the same
   * keys, which is what makes one dashboard possible.
   */
  properties(record: NetworkRecord): Record<string, unknown> {
    return {
      method: record.method,
      url: this.normalizeUrl(record.url),
      status: record.status,
      durationMs: Math.round(record.durationMs),
      transport: this.transport,

      ...readPageContext(),
    };
  }

  private emit(name: string, record: NetworkRecord): void {
    this.recorder.track(name, this.properties(record));
  }
}
