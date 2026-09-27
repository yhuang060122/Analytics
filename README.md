# Analytics

Frontend tracking SDK. TypeScript, browser-first.

> Language: English | [简体中文](README.zh-CN.md)

The repository is a **directory of sources, not an npm package** —
there is no `package.json` at the root. What needs installing lives
in three self-contained islands (`demo/`, `build/`, `tests/`), each
with its own lockfile. You import the SDK by path, not by name.

---

## Get started

### Requirements

- **Node.js ≥ 20** (developed and tested on 22.x)
- **npm ≥ 9**
- Nothing global to install. Each island installs its own tools.

### Install

```bash
npm --prefix demo install      # vite + typescript (runs the demo, compiles the tests)
npm --prefix build install     # tsup + typescript (builds the bundles)
```

`tests/` installs nothing — its script reaches for the TypeScript in
`demo/node_modules`.

### Run the demo

```bash
npm --prefix demo run dev
```

Open **http://localhost:5173**. It is a Vite multi-page app:

| Page | What it exercises |
| --- | --- |
| `/` (index) | clicks, page views, the debug inspector, manual flush |
| `/portfolio` | fetch tracking against the mock API |
| `/watchlist` | jQuery-style requests, outage/retry behaviour |

The SDK instance is shared across pages in `demo/src/analytics.ts`;
the debug toolbar controls live in `demo/src/inspector-toolbar.ts`.

The dev server ships a **mock collector** (`demo/vite.config.ts`),
so the whole pipeline can be exercised end to end:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/analytics/events` | accepts SDK batches, logs them to the terminal |
| `GET /api/analytics/outage?state=on\|off` | simulates a 500 to exercise queue retry |
| `GET /api/portfolio` | sample data for the portfolio page |
| `GET /api/news` | sample data for the watchlist page |

### Common commands

| What | Command |
| --- | --- |
| Run the demo (dev server) | `npm --prefix demo run dev` |
| Typecheck + build the demo | `npm --prefix demo run build` |
| Build the SDK bundles | `npm --prefix build run build` |
| Run the test suite | `npm --prefix tests run test` |

- `npm --prefix tests run test` compiles `analytics/` to
  `tests/.build` with tsc, then runs `node --test`. It is the
  command to run after touching `core/` or `adapters/`.
- `npm --prefix build run build` writes `dist/analytics.js` (ESM
  barrel) and `dist/analytics.iife.js` (self-installing `<script>`
  build). See [Build](#build).
- `npm --prefix demo run build` runs the demo through a strict
  TypeScript config (`noUnusedLocals`, `verbatimModuleSyntax`),
  which is stricter than the SDK build — a good last check before
  committing.

---

## Project structure

```
analytics/                  the SDK itself
  core/                     framework-agnostic engine — never imports adapters/
    api/                    ports & the SDK: Analytics, EventRecorder/Tracker
                            (tracker.ts), the adapter plugin contract (plugin.ts)
    domain/                 event / context / session / id (id.ts holds the
                            crypto → getRandomValues → Math.random fallback)
    factory/                EventFactory: track()/page() → AnalyticsContext
    queue/                  EventQueue: batching, retry + backoff, overflow
    transport/              Destination port + HttpDestination (HTTP POST,
                            timeout + keepalive gating)
    debug/                  DebugController, event bus, plugin registry,
                            console + inspector built-ins
    dom.ts                  hasDom() guard for construction-time DOM access
    warn.ts                 warnOnce() — degrade loudly, exactly once
  adapters/                 probes — depend inward on core/
    browser/                click-tracker, page-tracker, fetch-tracker,
                            auto-track.ts (startAutoTrack)
    network/                NetworkTrackerCore (shared event names/ignore rule)
                            + active-recorder.ts (script-tag slot)
    jquery/                 JQueryAjaxTracker ($.ajax global events)
    angular/                createAnalyticsInterceptor (HttpClient)
    detect.ts               runtime feature detection
    page-context.ts         readPageContext() — the one place the page triple comes from
    registry.ts             name → adapter table (plugin discovery)
    index.ts                init() — the composition root
  index.ts                  public barrel (framework adapters NOT re-exported)
  iife.ts                   <script> build entry — side effects, self-installs

demo/                       Vite multi-page demo + mock collector
build/                      tsup config → dist/analytics.js, dist/analytics.iife.js
tests/                      node --test suite (zero dependencies)
dist/                       build output (git-ignored)
```

The direction that matters: **core never imports adapters.** Adapters
depend inward on core's ports; wiring happens only in the composition
root (`adapters/index.ts`). `tests/architecture.test.mjs` enforces
this and a dozen other invariants mechanically.

---

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
decision. `destroy()` and `unregisterTracker()` stop probes;
`await analytics.close()` is the awaitable variant. See
[Delivery & teardown](#delivery--teardown).

**Idempotent by construction.** Every probe extends
`BaseTracker`, which owns the running flag. Subclasses implement
`onStart()`/`onStop()` and cannot double-register their listeners
by accident. `canStart()` is the escape hatch for a probe whose
runtime may not exist (jQuery): `start()` then leaves it stopped
instead of half-started.

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
    page-context.ts          where the event happened; SSR-safe
    registry.ts              name -> adapter table (discovery)
    index.ts                 init() — the composition root
  index.ts                   public barrel
  iife.ts                    <script> build entry — side effects
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

Those two names are **not configurable per transport**.
`successEventName` / `errorEventName` used to exist as options:
nothing ever set them, and their mere presence implied a
transport may name its events differently — the one thing this
module exists to prevent. `enrich()` went the same way; it would
have let one stack add properties the others do not have.

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
- **Idempotent by construction.** Probes extend `BaseTracker`
  and implement `onStart()` / `onStop()`; the `running` flag
  lives in the base class, so a probe cannot forget the guard
  and double-register its listeners. `canStart()` is the hook
  for probes whose runtime may not exist.

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

Two switches can turn an adapter on or off, and they resolve the
same way in both entry points:

| Config | Effect |
| --- | --- |
| *(absent)* | on, if the runtime has it |
| `network: false` | network tracking off entirely |
| `network: { fetch: false }` | that transport off |
| `frameworks: { fetch: false }` | force off, wins over `network` |
| `adapters: { fetch: false }` | per-adapter, wins over everything above |

`init()` and `registerDetectedAdapters()` share one resolver, so
`init({ network: { fetch: false } })` cannot install the adapter
through one path and skip it through the other. The general form is
`adapters: { <name>: <boolean | options> }`, which is also how a
third-party adapter is configured — see [Adapters as plugins](#adapters-as-plugins).

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

## Adapters as plugins

Every built-in adapter — click, page, fetch, jQuery, Angular — is a
*plugin* now: a descriptor sitting in one registry
(`adapters/registry.ts`), implementing one contract
(`core/api/plugin.ts`). `init()` no longer carries a switch table of
names; it installs whatever is registered. That is what makes a
third-party adapter possible without touching the SDK.

The contract has two roles, because only one of them can be started
by us:

```ts
import type { AnalyticsPlugin } from "analytics";

export const vueRouter: AnalyticsPlugin<{ routes: unknown }> = {
  name: "vue-router",

  available: () => typeof router !== "undefined",

  start(host, options) {
    const off = options.routes.afterEach(to => host.page(to.fullPath));
    host.registerTracker({ start: () => {}, stop: off });
  },
};
```

- `name` — identity, and the config key it is addressed by.
- `available?(host)` — whether the runtime supports it. Detection is
  per-adapter on purpose: it used to be a switch table that had to be
  kept in sync with the adapter, so adding a transport meant editing a
  second file that had to agree with the first.
- `start(host, options)` — install. `host` is a `PluginHost`: it
  records events (`track` / `page`), registers trackers for teardown,
  and exposes `debug`.
- `stop?()` — release anything `start()` took that is not already a
  registered tracker.

`AdapterIntegration` is the second role, for adapters the *app*
drives. An HTTP interceptor cannot attach itself to `HttpClient`, so
there is nothing to start — it exposes `create(host)` instead of a
lifecycle, and reports as `manual`. The Angular adapter is the
built-in example.

**Register** one of three ways — `registerAdapter(plugin)` before
`init()`, `init({ plugins: [plugin] })`, or, from a `<script>`,
`window.analyticsAdapters = [plugin]`:

```ts
import { registerAdapter, init } from "analytics/adapters";

registerAdapter(vueRouter);

const analytics = init({
  endpoint: "/api/analytics/events",
  adapters: { "vue-router": { routes: router } },
});
```

**Configure** with `adapters.<name>`: `false` disables it, an object
becomes its options. The legacy switches (`network`, `frameworks`,
`autoTrack`) stay as aliases. Precedence, most specific first:
`adapters.*` → `frameworks.*` / `autoTrack.*` → `network.*` →
`network: false` → on.

**Inspect** with `listAdapters()`, `getAdapter(name)`, and the report
from `installAdapters()` / `registerDetectedAdapters()` — its
`adapters` map has one entry per registered adapter
(`registered` / `skipped` / `unavailable` / `manual`), while
`fetch` / `jquery` / `angular` stay at the top level for the old
callers.

A new adapter's footprint is **one file** (descriptor + logic) plus
one `registerAdapter(...)` call in the host app. No SDK file changes:
no case added to a switch, no `detect.ts` entry, no report shape.

## jQuery project

Script tag — no bundler, no imports:

```html
<script src="/vendor/jquery.min.js"></script>
<script>
  // Read by analytics.iife.js when it installs itself.
  window.analyticsOptions = { endpoint: "/api/analytics/events" };
</script>
<script src="/analytics.iife.js"></script>
<!-- window.analytics exists from here on -->
```

That build is the only artefact that installs itself; see
[Build](#build). It is all side effects, and it reads
`window.analyticsOptions` once, on DOMContentLoaded — which is
why the options may be set after the script tag. Set them from
a deferred module instead and there is nothing to read yet:
the build warns once and installs nothing.

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

## Entry points

The barrel never pulls in a framework adapter, so importing the
root is safe everywhere:

```
analytics/index.ts           core + browser + network + init + detect
analytics/adapters/index.ts  init, getAnalytics, reset,
                             registerFetchAdapter, registerDetectedAdapters
analytics/adapters/network/  NetworkTrackerCore, active recorder
analytics/adapters/jquery/   JQueryAjaxTracker
analytics/adapters/angular/  createAnalyticsInterceptor (fn + class)
```

The last two are reached by their own path on purpose: that is
what keeps Angular out of a jQuery bundle, since importing the
root never sees them.

Samples in this README write imports as `analytics/…` for
brevity. There is no package to install, so point them at
wherever you keep the sources — the demo uses a relative path.

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

**SPA navigation.** `PageTracker` reports one `page` event when it
starts, plus a `Page Duration` when the tab is hidden or unloaded.
It does **not** watch the History API, so a client-side route
change is not a page view — call it from your router:

```ts
router.afterEach(to => analytics.page(to.fullPath));
```

`page(path)` defaults to `location.pathname` and puts `title` in
the properties, which you can override. There used to be a
`PageTracker.navigate()` for exactly this; nothing called it, and
a probe the app has to drive by hand is just a method call on the
instance.

**Global pollution.** One global, opt-out with
`globalName: false`. `window.fetch` is patched but restored on
`stop()`/`destroy()`; patch after other libraries that wrap
fetch, or they will capture each other.

**No crypto, no storage.** `crypto.randomUUID` exists only in a
secure context, so plain-http intranet pages and sandboxed iframes
have none — and private mode can refuse `sessionStorage` outright.
Reading either unguarded threw out of `init()` before the host app
had done anything wrong. Now `core/domain/id.ts` falls through
`crypto.getRandomValues` to `Math.random` (same v4 shape on every
branch), `Session` keeps the id in memory when storage refuses it,
and `track()` / `page()` swallow whatever is left after warning once.
An event may be dropped; the page keeps working.

**Personal data in clicks.** `Element Clicked` reports
`element`, `tag`, `id` and `cssClass`, but **not** the element's
text — `text` is `null` unless the element also carries
`data-analytics-text`. Element text is the one property that
routinely carries personal data ("Hi Sarah", a message preview),
so it is opt-in per element. The key stays present so the
property schema does not depend on which element was clicked.

**SSR.** Three things keep a Node render from throwing:

- `readPageContext()` (`adapters/page-context.ts`, shared by every
  probe) returns empty strings instead of touching `document`.
- jQuery / Angular adapters no-op when their framework is absent.
- Everything that reaches for a DOM global at *construction*
  time is behind `hasDom()` (`core/dom.ts`): `new Analytics()`
  registers its `visibilitychange` / `beforeunload` listeners
  only when one exists, and so does the queue's `online`
  listener.

What is still browser-only is *tracking*: `track()` and `page()`
read `location`, `document.title` and `navigator`. Constructing
and destroying the SDK on the server is safe; recording events
there is not.

## Delivery & teardown

The queue ships a batch only once the destination accepted it:

```
track() → queued → flushing ──ok──▶ removed
                      │
                      └──fail──▶ stays queued, retry with backoff
                                  (retryDelay × 2ⁿ, capped at 30s)
                                  after maxRetries → dropped, one
                                  terminal "failed" debug event
```

| Option | Default | Meaning |
| --- | --- | --- |
| `batchSize` | `20` | events per request |
| `flushInterval` | `1000` | ms before an automatic flush |
| `maxRetries` | `3` | retries before a batch is dropped |
| `retryDelay` | `1000` | base backoff, doubling, capped at 30s |
| `maxQueueSize` | `500` | oldest event is dropped when full |
| `timeoutMs` | `10000` | how long a request may be in flight; `0` disables it |

A failed batch is never lost to a *temporary* outage, and an
`online` event flushes immediately instead of waiting out the
backoff. `flush()` never rejects — every automatic caller does
`void this.flush()`, so a rejection would surface as an unhandled
promise rejection.

A `flush()` that finds one already running hands back that same
promise instead of resolving at once, so `await flush()` really
means "the buffer has been dealt with" and not "a flush has been
scheduled". That is what makes `close()` trustworthy.

**Requests that never answer.** A black-holed route or a captive
portal leaves a request pending forever, which used to park the
queue on a promise that would never settle — no retry, no failure,
event loss by silence. The transport now arms an `AbortController`
and treats `timeoutMs` as a failed attempt, so the same retry budget
applies. Set `timeoutMs: 0` to opt out.

**`keepalive` is spent on the last request only.** Browsers cap how
much may be in flight that way at once, so spending it on ordinary
batches is how the one request that cannot be retried loses its slot.
Every flush therefore leaves it off except the tab-hidden /
`beforeunload` one. Bodies over ~60KB cannot use it either — those
are refused outright — so they go without rather than not at all.
`navigator.sendBeacon` is deliberately not used for that last
request: it reports success before knowing anything delivered, and
"did it arrive?" is the one thing the queue's retry logic needs.

Teardown releases everything the instance owns:

- `destroy()` — idempotent; stops every probe, removes its own
  `visibilitychange` / `beforeunload` listeners, stops the
  queue's timers and `online` listener, then makes one last
  best-effort flush.
- `close()` — same, but awaits the flush. Use it when you need
  to know the buffer is empty (tests, SPA unmount).
- After either, `track()` / `page()` are no-ops and
  `isDestroyed` is `true`.

Every listener the SDK registers is a named field, so
`architecture.test.mjs` fails if one is added without a matching
`removeEventListener`.

## Debug plugins

`core/debug` is exported from the root barrel, so anything can
watch the pipeline without being wired into the SDK:

```ts
import type { DebugEvent, DebugPlugin } from "analytics";

const toDatadog: DebugPlugin = {
  name: "datadog",
  onEvent(event: DebugEvent) {
    metrics.increment(`analytics.${event.stage}`);
  },
};

const off = analytics.debug.registerDebugPlugin(toDatadog);
// ...
off(); // or: analytics.debug.unregisterDebugPlugin("datadog")
```

- Registering a name that is already taken **replaces** the
  previous plugin, so a hot reload cannot deliver every event
  twice.
- `stop?()` is the teardown hook. It runs on `unregister` and on
  `Analytics.destroy()` / `close()`, so no plugin outlives the
  SDK.
- Plugins receive nothing while `debug.enabled` is false —
  `emit()` short-circuits before the bus.
- A `failed` event carries `reason` next to the free-form
  `error`: `queue-overflow` (dropped before it was ever sent),
  `undeliverable` (the SDK stopped retrying), `transport-error`
  (the request itself failed) and `timeout` (nothing was refused,
  the peer never answered). Match on `reason`, not on the message
  text.
- **A plugin cannot break the page.** `emit()` calls each listener
  inside its own try/catch: one throwing plugin used to propagate
  through `DebugController` and `EventFactory` into the host app's
  own click handler. It now warns once, and a plugin that fails
  three times in a row is unsubscribed (and dropped from
  `debugPlugins`) rather than called forever.
- `analytics.debug.debugPlugins` lists the attached names.

The two built-ins are plugins too, installed by name:

| Name | Module | Notes |
| --- | --- | --- |
| `console` | `core/debug/console-plugin.ts` | stateless; the console logger |
| `inspector` | `core/debug/inspector-plugin.ts` | owns the DOM panel; `stop()` removes it |

`debug: { console: true, inspector: true }` therefore means
"install these two names", and either can be removed the same way
as a custom plugin:

```ts
import { CONSOLE_PLUGIN } from "analytics";
analytics.debug.unregisterDebugPlugin(CONSOLE_PLUGIN);
```

Because the inspector's lifetime is its plugin's lifetime,
`destroy()` removes the panel with it.

## Build

```
npm --prefix build install        # once
npm --prefix build run build
```

There is no `package.json` at the root: the repository is a
directory of sources, not a package. What needs installing
lives in its own directory with its own lockfile — `demo/`
holds vite and the typescript the tests use, `build/` holds
tsup and the bundler, `tests/` holds the test script and
installs nothing at all. Nothing to install at the root means
nothing to forget at the root.

Inside `build/tsup.config.ts`: two entries, two formats, same
sources:

| File | Format | Loaded with |
| --- | --- | --- |
| `dist/analytics.js` | ESM, the barrel | `<script type="module">`, a bundler |
| `dist/analytics.iife.js` | IIFE, self-installing | `<script src="…">` |

The extension carries no module-system meaning here: nothing
declares `type: module`, so Node would read `analytics.js` as
CommonJS and fail on `export`. It is a browser artefact, not an
entry point anything resolves — consumers import the TypeScript
sources directly.

One rule goes with those two entries: nothing in `analytics/`
imports `iife.ts`. It is reachable only through
`build/tsup.config.ts`, because reaching it through the barrel
would mean importing the library installs the SDK with whatever
options the page happens to have set. The architecture test
asserts that, and that the root stays a directory of sources.

Deliberately left out of the build:

- **`.d.ts`** — consumers get types from the TypeScript sources
  they import; the demo builds from source too. Emitting
  declarations would pull typescript out of the islands it
  currently lives in.
- **minification** — the files are read by humans debugging a
  tracking issue on a page they do not control.
- **`clean`** — the two configs are built in parallel, so
  whichever ran first would see its output removed by the
  other. Both entries have fixed names, so a build overwrites
  its own file; rename one and the old artefact is left behind
  until the folder itself is deleted.

`build/` carries one odd entry: `@rollup/rollup-win32-x64-msvc`
is pinned as an optional dependency because npm skipped
rollup's platform binary (npm/cli#4828), and tsup loads rollup
whether or not declarations are emitted. npm ignores the pin on
other platforms.

## Tests

```
npm --prefix tests run test
```

No install needed — the script reaches for the typescript in
`demo/`. It compiles core + adapters with tsc into
`tests/.build`, then runs `node --test` over the files it lists
explicitly:

- `tracker-port.test.mjs` — probes driven by a bare
  `EventRecorder`, no `Analytics` instance needed
- `registry.test.mjs` — register/destroy semantics, listener
  counts, end-to-end event pipeline
- `queue.test.mjs` — failed batch stays buffered and is retried,
  dropped only after the retry budget, `flush()` never rejects,
  overflow drops the oldest, teardown clears every listener
- `debug-plugin.test.mjs` — plugins observe the whole pipeline,
  same-name registration replaces instead of doubling, unregister
  detaches silently
- `network.test.mjs` — all three transports emit identical names
  and properties; each adapter no-ops when its framework is
  missing; `init()` is idempotent; the `network` / `frameworks`
  option matrix resolves the same way in both entry points
- `robustness.test.mjs` — no `crypto.randomUUID`, storage disabled
  or absent, a throwing plugin, a request that never settles,
  `keepalive` gating, SSR construction, concurrent `flush()`
  sharing one request, `close()` draining the buffer, plus unit
  tests for ids / factory / session / destination
- `adapter-plugin.test.mjs` — the plugin registry: register /
  install / configure a third-party adapter, availability gating,
  a throwing adapter, name replacement, integrations report
  `manual`, `adapters.*` overriding the legacy switches
- `architecture.test.mjs` — asserts core never imports adapters,
  the barrel never pulls in a framework adapter, no adapter
  imports `@angular/*` or `rxjs`, every listener can be removed,
  the script-tag entry stays out of the library, the root owns
  no package.json, and the test script actually runs every
  `*.test.mjs`

## TODO

- Persistence for the queue (localStorage / IndexedDB) so events
  survive a reload
