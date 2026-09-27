/**
 * Public barrel, and the entry the ESM build is made from.
 *
 * Framework adapters are NOT re-exported here on purpose.
 * Importing this must not pull Angular or jQuery into a
 * project that has neither, so they are reached by their own
 * path instead:
 *
 *   import { JQueryAjaxTracker } from "./adapters/jquery";
 *   import { createAnalyticsInterceptor } from "./adapters/angular";
 */
export * from "./core/api";
export * from "./core/debug";
export * from "./core/domain";
export * from "./core/factory";
export * from "./core/queue";
export * from "./core/transport";

export * from "./adapters/browser";
export * from "./adapters/detect";
export * from "./adapters/network";
export * from "./adapters";
