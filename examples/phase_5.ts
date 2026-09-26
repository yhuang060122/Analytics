import { Analytics } from "..";

export const analytics = new Analytics({
  endpoint: "/api/analytics/events",

  batchSize: 20,

  flushInterval: 1000,
});

analytics.track("ButtonClicked", {
  button: "Save",
  section: "Portfolio",
});

analytics.page();

analytics.page("/settings", {
  tab: "General",
});

// 手动 Flush
await analytics.flush();
