import { Analytics } from "../../core/api/analytics";

export const analytics = new Analytics({

  endpoint: "/api/analytics/events",

  batchSize: 20,

  flushInterval: 1000,

  autoTrack: {

    page: true,

    click: true,

    api: false,

  }

  debug: {
    inspector: !environment.production
  }

});