// adapters/angular/analytics.interceptor.ts

import type { EventRecorder } from "../../core/api/tracker";
import { getActiveRecorder } from "../network/active-recorder";
import {
  NetworkTrackerCore,
  type NetworkTrackerOptions,
} from "../network/network-core";

/**
 * Structural copies of the Angular HTTP shapes this file
 * touches.
 *
 * Deliberately NOT imported from @angular/common/http: even
 * an `import type` would force every consumer to have Angular
 * installed just to typecheck. These are narrower than the
 * real types, which is fine — this file only reads method,
 * url, status and the event type.
 *
 * In an Angular project you may swap them for the real
 * imports; the runtime code does not change.
 */
export interface HttpRequestLike {
  method: string;
  url: string;
  urlWithParams?: string;
}

export interface HttpEventLike {
  type?: number;
  status?: number;
}

export interface SubscriberLike<T> {
  next(value: T): void;
  error(err: unknown): void;
  complete(): void;
}

export interface ObservableLike<T> {
  subscribe(
    observer: Partial<SubscriberLike<T>>,
  ): { unsubscribe(): void };
}

/** Angular 15+: `HttpHandlerFn`. */
export type HttpHandlerFnLike = (
  request: HttpRequestLike,
) => ObservableLike<HttpEventLike>;

/** Angular <15: the class interceptor's `next` argument. */
export interface HttpHandlerLike {
  handle(request: HttpRequestLike): ObservableLike<HttpEventLike>;
}

/** `HttpEventType.Response`. */
const HTTP_EVENT_RESPONSE = 4;

function isResponse(event: HttpEventLike): boolean {
  return event.type === HTTP_EVENT_RESPONSE || typeof event.status === "number";
}

function readStatus(value: unknown): number {
  if (typeof value === "number") return value;

  if (value && typeof value === "object") {
    const status = (value as { status?: unknown }).status;

    if (typeof status === "number") return status;
  }

  return 0;
}

/**
 * Observes an RxJS observable without importing rxjs.
 *
 * A new Observable forwarding `subscribe` is what an operator
 * is internally, so this composes with any RxJS 6/7 version.
 * If the constructor trick ever fails it returns the original
 * stream untouched — tracking must not break the app's HTTP
 * calls.
 *
 * Projects that already depend on rxjs can replace the body
 * with `import { tap } from "rxjs"`.
 */
function spy<T>(
  source: ObservableLike<T>,
  handlers: {
    onNext?: (value: T) => void;
    onError?: (error: unknown) => void;
  },
): ObservableLike<T> {
  const ctor = (source as { constructor?: unknown }).constructor;

  if (typeof ctor !== "function") return source;

  try {
    const ObservableCtor = ctor as new (
      subscribe: (subscriber: SubscriberLike<T>) => unknown,
    ) => ObservableLike<T>;

    return new ObservableCtor(subscriber =>
      source.subscribe({
        next: value => {
          try {
            handlers.onNext?.(value);
          } catch {
            /* never break the request */
          }

          subscriber.next(value);
        },

        error: error => {
          try {
            handlers.onError?.(error);
          } catch {
            /* never break the request */
          }

          subscriber.error(error);
        },

        complete: () => subscriber.complete(),
      }),
    );
  } catch {
    return source;
  }
}

function resolveRecorder(
  recorder?: EventRecorder,
): EventRecorder | undefined {
  return recorder ?? getActiveRecorder();
}

const NOOP_RECORDER: EventRecorder = {
  track: () => undefined,
  page: () => undefined,
};

/**
 * Functional interceptor for Angular 15+.
 *
 * ```ts
 * provideHttpClient(
 *   withInterceptors([createAnalyticsInterceptor(analytics)]),
 * )
 * ```
 */
export function createAnalyticsInterceptor(
  recorder?: EventRecorder,
  options: NetworkTrackerOptions = {},
): (
  request: HttpRequestLike,
  next: HttpHandlerFnLike,
) => ObservableLike<HttpEventLike> {
  const target = resolveRecorder(recorder);

  const core = new NetworkTrackerCore(target ?? NOOP_RECORDER, {
    transport: "angular",
    ...options,
  });

  return (request, next) => {
    const url = request.urlWithParams ?? request.url;
    const started = performance.now();

    if (!target || core.shouldIgnore(url)) {
      return next(request);
    }

    return spy(next(request), {
      onNext: event => {
        if (!isResponse(event)) return;

        core.record({
          method: request.method,
          url,
          status: readStatus(event),
          durationMs: performance.now() - started,
        });
      },

      onError: error => {
        core.recordError({
          method: request.method,
          url,
          status: readStatus(error),
          durationMs: performance.now() - started,
        });
      },
    });
  };
}

/**
 * Class-style interceptor for Angular < 15 or DI wiring.
 *
 * ```ts
 * { provide: HTTP_INTERCEPTORS,
 *   useFactory: () => createAnalyticsHttpInterceptor(analytics),
 *   multi: true }
 * ```
 *
 * `HTTP_INTERCEPTORS` stays on the app side: importing it here
 * would drag @angular into every other stack.
 */
export function createAnalyticsHttpInterceptor(
  recorder?: EventRecorder,
  options: NetworkTrackerOptions = {},
): {
  intercept: (
    request: HttpRequestLike,
    next: HttpHandlerLike,
  ) => ObservableLike<HttpEventLike>;
} {
  const run = createAnalyticsInterceptor(recorder, options);

  return {
    intercept(request, next) {
      return run(request, req => next.handle(req));
    },
  };
}

/**
 * Not a Tracker on purpose: an Angular interceptor cannot
 * attach itself, it has to be provided at bootstrap. Exposed
 * so `init()` can report why nothing was auto-registered.
 */
export function describeAngularWiring(): string {
  return "angular: provide the interceptor via HttpClient providers";
}
