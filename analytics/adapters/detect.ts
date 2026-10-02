// adapters/detect.ts

/**
 * Runtime feature detection.
 *
 * A plain capability reader: it reports what the runtime has,
 * it installs nothing. Probes ask their own runtime whether
 * they can start (via `BaseTracker.canStart()`); these helpers
 * exist for callers that want to gate wiring themselves, and
 * keep a jQuery-only page from ever touching Angular code.
 */

export interface JQueryCollectionLike {
  ajaxSend(handler: unknown): unknown;
  ajaxSuccess(handler: unknown): unknown;
  ajaxError(handler: unknown): unknown;
  off(event: string, handler?: unknown): unknown;
}

export interface JQueryLike {
  ajax?: unknown;
  ajaxPrefilter?: unknown;
  (target: unknown): JQueryCollectionLike;
}

export interface EnvironmentCapabilities {
  /** window.fetch exists — the fetch adapter can run. */
  fetch: boolean;

  /** jQuery with its ajax stack — the jQuery adapter can run. */
  jquery: boolean;

  /** window.angular (AngularJS 1.x) is present. */
  angularjs: boolean;

  /** window.ng (Angular dev-mode global) is present. */
  angularDevMode: boolean;

  /** document/window available at all. */
  dom: boolean;
}

type Scope = Record<string, unknown>;

function readScope(): Scope {
  if (typeof globalThis === "undefined") return {};

  return globalThis as unknown as Scope;
}

/**
 * jQuery announces itself with `jQuery` or `$`, but `$` is
 * also claimed by other libraries, so `$.ajax` is the real
 * signal — not the bare global.
 */
export function getJQuery(): JQueryLike | undefined {
  const scope = readScope();

  const candidate =
    (scope["jQuery"] as JQueryLike | undefined) ??
    (scope["$"] as JQueryLike | undefined);

  if (typeof candidate !== "function") return undefined;
  if (typeof candidate.ajax !== "function") return undefined;

  return candidate;
}

export function isJQueryAvailable(): boolean {
  return getJQuery() !== undefined;
}

/**
 * AngularJS 1.x always sets `window.angular`.
 *
 * Angular 2+ does not, and `window.ng` only exists in dev
 * builds — so this is a hint, never the wiring mechanism.
 * Angular apps register the interceptor explicitly through
 * providers; see adapters/angular.
 */
export function isAngularAvailable(): boolean {
  const scope = readScope();

  const angularjs = typeof scope["angular"] !== "undefined";
  const devMode = typeof scope["ng"] !== "undefined";

  return angularjs || devMode;
}

export function isFetchAvailable(): boolean {
  const scope = readScope();

  return typeof scope["fetch"] === "function";
}

export function detectEnvironment(): EnvironmentCapabilities {
  const scope = readScope();

  return {
    fetch: typeof scope["fetch"] === "function",
    jquery: isJQueryAvailable(),
    angularjs: typeof scope["angular"] !== "undefined",
    angularDevMode: typeof scope["ng"] !== "undefined",
    dom:
      typeof scope["document"] !== "undefined" &&
      typeof scope["window"] !== "undefined",
  };
}
