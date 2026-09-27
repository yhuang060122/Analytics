# Analytics

Frontend tracking SDK. TypeScript, browser-first.

## Layers

```
adapters/   probes: Click, Page, Network (fetch / jQuery / Angular)
   | depends inward
   v
core/       domain, factory, queue, transport, api, debug
```

**core never imports adapters.** The contract lives in
`core/api/tracker.ts`:

- `EventRecorder` — what a probe may do to the SDK (`track`, `page`)
- `Tracker` — lifecycle (`start`, `stop`)

Probes depend on `EventRecorder` and implement `Tracker`. Wiring
happens in the **composition root** (the app), never inside
core.

```ts
import { Analytics } from "./analytics/core/api/analytics";
import { startAutoTrack } from "./analytics/adapters/browser/auto-track";

const analytics = new Analytics({ endpoint: "/api/analytics/events" });

analytics.registerTracker(
  startAutoTrack(analytics, { page: true, click: true }),
);
```

`registerTracker()` only registers — starting is the caller's
decision. `destroy()` and `unregisterTracker()` stop probes.

## One API, several stacks

Three transports used to duplicate their own event names,
property shape and ignore rule. `adapters/network/` owns those
now; each framework adapter only translates its own lifecycle
into `record()` calls.

```
analytics/
  core/                      framework-agnostic SDK
    api/  domain/  factory/  queue/  transport/  debug/
  adapters/
    browser/                 DOM probes: click, page, fetch
    network/                 <-- shared network core
      network-core.ts        naming, properties, ignore rule,
                             status classification, transport tag
      active-recorder.ts     slot for the script-tag flow
    jquery/                  $.ajax global events
    angular/                 HttpClient interceptor
    detect.ts                runtime feature detection
    index.ts                 init() — the composition root
  index.ts                   public barrel
```

Every transport emits the same two event names and tags itself:

```json
{ "name": "API Request",
  "properties": {
    "method": "GET", "url": "/api/users", "status": 200,
    "durationMs": 42, "transport": "fetch",
    "pagePath": "/portfolio", "pageUrl": "...", "pageTitle": "..."
  } }
```

`transport` is `fetch`, `jquery` or `angular` — filter on it
instead of on three different event names.

### Rules the adapters follow

- **No package dependency.** Neither `adapters/angular` nor
  `adapters/jquery` imports `@angular/*` or `rxjs`; they use
  structural types. A jQuery project therefore never needs
  Angular installed to build, and vice versa. `HTTP_INTERCEPTORS`
  stays on the app side for the same reason.
- **No ambient globals.** The jQuery adapter looks `$` up at
  runtime, so there is no `declare const $` forcing
  `@types/jquery` onto consumers.
- **Never break the host.** `start()` no-ops when the framework
  is missing, and every observation is wrapped so a tracking
  failure cannot fail an HTTP request.

## Entry point

```ts
import { init } from "analytics/adapters";

const analytics = init({
  endpoint: "/api/analytics/events",
  batchSize: 20,
  autoTrack: { page: true, click: true },
  network: { fetch: true, ignoreUrls: ["/internal/health"] },
});
```

`init()` is **synchronous and idempotent** — a second call (or a
script tag included twice) returns the first instance instead of
registering a second set of probes, which would double every
event. `getAnalytics()` reads it back, `reset()` tears it down
for tests and hot reload.

Adapters that cannot be wired synchronously are opted into
separately:

```ts
const report = await registerDetectedAdapters(analytics);
// { fetch: "registered", jquery: "registered", angular: "manual" }
```

`angular: "manual"` is not a gap: an HTTP interceptor cannot
attach itself to `HttpClient`, the app must provide it.

With no arguments it inherits the options `init()` was called
with, so `init({ network: false })` is not silently undone by a
later `registerDetectedAdapters()`. Explicit arguments win over
that fallback. Every value is `registered` / `skipped` /
`unavailable` (and `manual` for Angular), where `skipped` means
"present but disabled by config".

If you build the SDK yourself instead of calling `init()`, the
sync half is public too:

```ts
import { Analytics } from "analytics";
import { registerFetchAdapter } from "analytics/adapters";

const analytics = new Analytics({ endpoint: "/api/analytics/events" });

registerFetchAdapter(analytics, { ignoreUrls: ["/health"] });
// false when window.fetch does not exist (SSR, old browser)
```

It is idempotent by design: network adapters patch globals, and
a second FetchTracker would capture the already-patched fetch as
its "original", so one request would emit two `API Request`
events. `registerFetchAdapter` and `registerDetectedAdapters`
both refuse to stack.

### Detection

`detect.ts` inspects the runtime and registers only what exists:

| Signal | Enables |
|---|---|
| `window.fetch` is a function | fetch adapter |
| `jQuery` / `$` has `.ajax` | jQuery adapter |
| `window.angular` / `window.ng` | reports `manual` |

`$.ajax` is the real signal, not the bare `$` global, which
other libraries also claim. `window.angular` only proves
AngularJS 1.x — Angular 2+ in a production build exposes no
reliable global, which is why Angular wiring is explicit.

```ts
import { detectEnvironment } from "analytics/adapters/detect";

detectEnvironment();
// { fetch: true, jquery: false, angularjs: false,
//   angularDevMode: false, dom: true }
```

## jQuery project

Script tag — enable by loading, no build step:

```html
<script src="/vendor/jquery.min.js"></script>
<script src="/analytics.js"></script>
<script>
  // window.analytics exists: the IIFE build calls init() itself
  // and reads window.analyticsOptions.
  window.analyticsOptions = { endpoint: "/api/analytics/events" };
</script>
```

Order matters: **jQuery must load first.** If it does not,
detection finds nothing, the adapter stays a no-op and the page
keeps working — you lose jQuery tracking, nothing else.

With a bundler:

```ts
import { init, registerDetectedAdapters } from "analytics/adapters";

const analytics = init({ endpoint: "/api/analytics/events" });

await registerDetectedAdapters(analytics);
```

## Angular project

```ts
// app.config.ts
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { init } from "analytics/adapters";
import { createAnalyticsInterceptor } from "analytics/adapters/angular";

const analytics = init({ endpoint: "/api/analytics/events" });

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(
      withInterceptors([createAnalyticsInterceptor(analytics)]),
    ),
  ],
};
```

Angular 15+ takes a plain function, so no decorator and no DI
token are involved. For older versions:

```ts
import { HTTP_INTERCEPTORS } from "@angular/common/http";
import { createAnalyticsHttpInterceptor } from "analytics/adapters/angular";

{
  provide: HTTP_INTERCEPTORS,
  useFactory: () => createAnalyticsHttpInterceptor(analytics),
  multi: true,
}
```

Both accept no recorder and fall back to the one `init()`
stored, which is how a script-tag install reaches Angular:

```ts
withInterceptors([createAnalyticsInterceptor()]);
```

## Exports

The barrel never pulls in a framework adapter, so
`import "analytics"` is safe everywhere:

```
analytics                  core + browser + network + init + detect
analytics/adapters         init, getAnalytics, reset,
                           registerFetchAdapter, registerDetectedAdapters
analytics/adapters/network NetworkTrackerCore, active recorder
analytics/adapters/jquery  JQueryAjaxTracker
analytics/adapters/angular createAnalyticsInterceptor (fn + class)
```

The last two are subpath exports on purpose: this is what keeps
Angular out of a jQuery bundle.

## Boundary cases

**Load order.** jQuery before the SDK. Angular does not care —
the interceptor is provided at bootstrap, after `init()`.

**Duplicate reporting.** Two guards, both easy to lose:

- `init()` is idempotent, so two entry points cannot produce two
  SDKs.
- The SDK's own endpoint is in `DEFAULT_IGNORE_URLS` and is
  **merged** with `ignoreUrls`, never replaced. A user who sets
  `ignoreUrls: ["/health"]` still cannot start a report →
  `API Request` → report loop.

Overlapping adapters do not double-count: `$.ajax` handlers only
fire for jQuery-initiated requests, and Angular's `HttpClient`
uses XHR, so a page with jQuery and Angular does not report the
same call twice. It can report *different* calls twice if the
app calls `$.ajax` directly inside Angular — filter on
`transport` in that case.

**Global pollution.** One global, opt-out with
`globalName: false`. `window.fetch` is patched but restored on
`stop()`/`destroy()`; patch after other libraries that wrap
fetch, or they will capture each other.

**SSR.** `readPageContext()` returns empty strings instead of
touching `document`, and jQuery/Angular adapters no-op when their
framework is absent, so a Node render does not throw. Call
`init()` from a browser-only entry point anyway.

## Tests

```
npm test
```

Compiles core + adapters with tsc, then runs `node --test tests/`:

- `tracker-port.test.mjs` — probes driven by a bare
  `EventRecorder`, no `Analytics` instance needed
- `registry.test.mjs` — register/destroy semantics, listener
  counts, end-to-end event pipeline
- `network.test.mjs` — all three transports emit identical names
  and properties; each adapter no-ops when its framework is
  missing; `init()` is idempotent
- `architecture.test.mjs` — asserts core never imports adapters,
  the barrel never pulls in a framework adapter, and no adapter
  imports `@angular/*` or `rxjs`

## TODO

- tsup build producing `analytics.js` (ESM + IIFE); the IIFE
  entry is what calls `init()` for the script-tag flow
- Persistence for the queue (localStorage / IndexedDB) so events
  survive a reload
