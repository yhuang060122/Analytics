// adapters/angular/index.ts

import type { AdapterIntegration } from "../../core/api/plugin";
import { isAngularAvailable } from "../detect";
import { createAnalyticsInterceptor } from "./analytics.interceptor";

export * from "./analytics.interceptor";

/**
 * The registry descriptor for Angular.
 *
 * An integration, not a plugin: an HTTP interceptor cannot
 * attach itself to `HttpClient`, so there is nothing to start.
 * It registers to show up in reports and to be looked up by
 * name; the app still provides the interceptor it returns.
 */
export const angularAdapter: AdapterIntegration = {
  name: "angular",
  available: () => isAngularAvailable(),
  create(host) {
    return createAnalyticsInterceptor(host);
  },
};
