import {
  AnalyticsContext,
  AnalyticsEvent,
  Session
} from "../domain";

import { DebugController } from "../debug/debug-controller";

export class EventFactory {

  constructor(
    private readonly debug: DebugController
  ) {}

  track(
    name: string,
    properties: Record<string, unknown> = {}
  ): AnalyticsContext {

    const event: AnalyticsEvent = {
      id: crypto.randomUUID(),
      type: "track",
      name,
      properties,
      timestamp: new Date().toISOString(),
    };

    return this.createContext(event);
  }

  page(
    path: string = window.location.pathname,
    properties: Record<string, unknown> = {}
  ): AnalyticsContext {

    const event: AnalyticsEvent = {
      id: crypto.randomUUID(),
      type: "page",
      name: path,
      properties: {
        title: document.title,
        ...properties,
      },
      timestamp: new Date().toISOString(),
    };

    return this.createContext(event);
  }

  private createContext(
    event: AnalyticsEvent
  ): AnalyticsContext {

    const context: AnalyticsContext = {
      sessionId: Session.current().id,
      url: window.location.href,
      referrer: document.referrer || null,
      userAgent: navigator.userAgent,
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