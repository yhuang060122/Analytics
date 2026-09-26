import { EventFactory } from "../core/factory";

const ctx = EventFactory.track("ButtonClicked", {
  button: "Save",
  section: "Portfolio",
});

console.log(ctx);

// {
//   "sessionId": "0c1d9c43-3a7f-4a34-90df-4d2fdc9d43b1",
//   "url": "https://localhost:4200/portfolio",
//   "referrer": "https://localhost:4200/",
//   "userAgent": "Mozilla/5.0 ...",
//   "event": {
//     "id": "6ef1...",
//     "type": "track",
//     "name": "ButtonClicked",
//     "properties": {
//       "button": "Save",
//       "section": "Portfolio"
//     },
//     "timestamp": "2026-09-25T19:18:10.213Z"
//   }
// }

const ctx2 = EventFactory.page();

// {
//   "event": {
//     "type": "page",
//     "name": "/portfolio",
//     "properties": {
//       "title": "Portfolio"
//     }
//   }
// }

EventFactory.page("/settings", {
  tab: "General",
});
