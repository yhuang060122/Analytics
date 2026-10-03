import { readPageContext } from "../domain/page-context";
import { readSessionId } from "../domain/session-id";
import type {
  AnalyticsContext,
  AnalyticsEvent
} from "../domain";

import type { DebugController } from "../debug/debug-controller";

/**
 * Builds the object the queue ships.
 *
 * It is the only consumer of `readSessionId()`, which is why that
 * function is off the public surface: nothing else needs a
 * correlation id, and a host that wants to end one is describing
 * something the SDK has no opinion about.
 */
export class EventFactory {

  private readonly debug: DebugController;

  constructor(
    debug: DebugController
  ) {
    this.debug = debug;
  }

  track(
    name: string,
    properties: Record<string, unknown> = {}
  ): AnalyticsContext {

    const event: AnalyticsEvent = {
      type: "track",
      name,
      properties,
      timestamp: new Date().toISOString(),
    };

    return this.createContext(event);
  }

  page(
    path?: string,
    properties: Record<string, unknown> = {}
  ): AnalyticsContext {

    // Read the page once, and only if there is one. This used
    // to be a default parameter — `path: string = window
    // .location.pathname` — which looked tidy and hid the real
    // shape: a default is evaluated at the call site, so
    // `analytics.page()` reached for `window` from inside the
    // facade's `record()`, three layers away from the only thing
    // that knew a browser was required. A server render got an
    // event dropped with one `warnOnce`, and since that fires
    // once per process, every render after it failed silently.
    const page = readPageContext();

    const event: AnalyticsEvent = {
      type: "page",
      name: path ?? page.pagePath,
      properties: {
        title: page.pageTitle,
        ...properties,
      },
      timestamp: new Date().toISOString(),
    };

    return this.createContext(event);
  }

  /**
   * The per-event envelope: who, where, and what the browser
   * says about itself.
   *
   * Every field degrades rather than throws. Recording on a
   * server produces an event with no `url` and no `userAgent`,
   * which is visibly incomplete downstream — and a dropped event
   * with a one-shot warning is not, because the second server
   * render fails the same way silently.
   */
  private createContext(
    event: AnalyticsEvent
  ): AnalyticsContext {

    // One read, and the only one. `readPageContext()` is already
    // SSR-safe — it returns empty strings rather than throwing —
    // so there is no guard here, and no `hasDom()` either. The
    // two values that are not part of that triple are read here
    // because nothing else reads them.
    const page = readPageContext();

    const scope = globalThis as {
      document?: Document;
      navigator?: { userAgent?: string };
    };

    const context: AnalyticsContext = {
      // Read per event, not cached: the host may write its
      // correlation id at any point — after a login, say — and a
      // value latched at construction would keep reporting the
      // absence for the rest of the visit.
      sessionId: readSessionId(),
      url: page.pageUrl,
      referrer: scope.document?.referrer || null,
      userAgent: scope.navigator?.userAgent ?? "",
      event,
    };

    // Debug → CREATED
    this.debug.emit({
      stage: "created",
      context,
      timestamp: Date.now(),
    });

    return context;

  }

}
