# Analytics

Frontend tracking SDK. TypeScript, browser-first.

## Layers

```
adapters/   probes: Click, Page, Fetch, jQuery ajax, Angular
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
core:

```ts
import { Analytics } from "./analytics/core/api/analytics";
import { startAutoTrack } from "./analytics/adapters/browser/auto-track";

const analytics = new Analytics({ endpoint: "/api/analytics/events" });

analytics.registerTracker(
  startAutoTrack(analytics, { page: true, click: true, api: true }),
);
```

`registerTracker()` only registers — starting is the caller's
decision. `destroy()` and `unregisterTracker()` stop probes.

`createBrowserAnalytics(config)` is a convenience factory that
still accepts the legacy `autoTrack` option: it builds the SDK
and registers the probes for you.

## Tests

```
npm test
```

Compiles core + the browser adapters with tsc, then runs
`node --test tests/`:

- `tracker-port.test.mjs` — probes driven by a bare `EventRecorder`,
  no `Analytics` instance needed
- `registry.test.mjs` — register/destroy semantics, listener
  counts, end-to-end event pipeline
- `architecture.test.mjs` — asserts core never imports adapters
  (source and compiled output), so the dependency direction
  cannot silently regress

## TODO

- How to manage different types of API calls?
  - `FetchTracker` → "fetch"
  - `AnalyticsHttpInterceptor` → "angular"
  - `JQueryAjaxTracker` → "jquery"
- tsup build producing `analytics.js`
