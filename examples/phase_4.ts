import { EventFactory, EventQueue, HttpDestination } from "..";

const destination = new HttpDestination({
  endpoint: "https://localhost:5001/api/analytics/events",
});

const queue = new EventQueue(destination);

queue.enqueue(
  EventFactory.track("ButtonClicked", {
    button: "Save",
  }),
);

queue.enqueue(EventFactory.page());

// {
//   "events": [
//     {
//       "sessionId": "0c1d...",
//       "url": "https://localhost:4200/dashboard",
//       "referrer": null,
//       "userAgent": "Mozilla/5.0 ...",
//       "event": {
//         "id": "evt_001",
//         "type": "track",
//         "name": "ButtonClicked",
//         "properties": {
//           "button": "Save"
//         },
//         "timestamp": "2026-09-25T18:40:00Z"
//       }
//     }
//   ]
// }
