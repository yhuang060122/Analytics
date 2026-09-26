/**
 * Public barrel.
 *
 * Framework adapters are NOT re-exported here on purpose.
 * `import "analytics"` must not pull Angular or jQuery into
 * a project that has neither, so they live behind subpath
 * exports:
 *
 *   import { JQueryAjaxTracker } from "analytics/adapters/jquery";
 *   import { createAnalyticsInterceptor } from "analytics/adapters/angular";
 */
export * from "./core/api";
export * from "./core/domain";
export * from "./core/factory";
export * from "./core/queue";
export * from "./core/transport";

export * from "./adapters/browser";
export * from "./adapters/detect";
export * from "./adapters/network";
export * from "./adapters";
