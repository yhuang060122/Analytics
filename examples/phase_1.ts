import { AnalyticsContext, Session } from "../core/domain";

const session = Session.current();

console.log(session.id);

const context: AnalyticsContext = {
  sessionId: session.id,
  url: window.location.pathname,
  referrer: document.referrer || null,
  userAgent: navigator.userAgent,
  event: {
    id: crypto.randomUUID(),
    type: "track",
    name: "ButtonClicked",
    properties: {
      button: "Save",
    },
    timestamp: new Date().toISOString(),
  },
};
