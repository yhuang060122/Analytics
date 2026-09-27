// adapters/jquery/index.ts

import type { AnalyticsPlugin } from "../../core/api/plugin";
import type { NetworkTrackerOptions } from "../network/network-core";
import { isJQueryAvailable } from "../detect";
import { JQueryAjaxTracker } from "./jquery-ajax-tracker";

export * from "./jquery-ajax-tracker";

/**
 * The registry descriptor for this transport.
 *
 * The module is reached through a dynamic import (see
 * `adapters/index.ts`), so a page without jQuery never pays for
 * it — but when it is loaded, this is what `init()` installs.
 */
export const jqueryAdapter: AnalyticsPlugin<NetworkTrackerOptions> = {
  name: "jquery",
  available: () => isJQueryAvailable(),
  start(host, options) {
    const tracker = new JQueryAjaxTracker(host, options);
    tracker.start();
    host.registerTracker(tracker);
  },
};
