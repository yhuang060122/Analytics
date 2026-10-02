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
| `/` (index) | clicks, page views, manual events, burst batching |
| `/portfolio` | a second page, so the session carries over |
| `/watchlist` | manual events on their own |

The SDK instance is shared across pages in `demo/src/analytics.ts`.
With `debug.console` on, every pipeline stage is logged to the
devtools console, so the pages themselves stay free of debug UI.

The dev server ships a **mock collector** (`demo/vite.config.ts`),
so the whole pipeline can be exercised end to end:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/analytics/events` | accepts SDK batches, logs them to the terminal |
| `GET /api/analytics/outage?state=on\|off` | simulates a 500 to exercise the drop path |
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
  command to run after touching anything under `analytics/`.
- `npm --prefix build run build` writes `dist/analytics.js`, the ESM
  barrel. See [Build](#build).
- `npm --prefix demo run build` runs the demo through a strict
  TypeScript config (`noUnusedLocals`, `verbatimModuleSyntax`),
  which is stricter than the SDK build — a good last check before
  committing.

---

## Project structure

```
analytics/
  core/                     the whole SDK
    api/                    ports & the facade: Analytics,
                            EventRecorder / Tracker / BaseTracker
                            (tracker.ts)
    probes/                 ClickTracker, PageTracker
    domain/                 event / context / session / id
                            (id.ts holds the crypto → getRandomValues
                            → Math.random fallback; page-context.ts is
                            the one place the page triple comes from)
    factory/                EventFactory: track() / page() → AnalyticsContext
    queue/                  EventQueue: batching + overflow drop (no retry)
    transport/              Destination port + HttpDestination (HTTP POST,
                            timeout + keepalive gating)
    debug/                  DebugController (the registry, the failure
                            isolation and the one console built-in)
    dom.ts                  hasDom() guard for construction-time DOM access
    warn.ts                 warnOnce() — degrade loudly, exactly once
  index.ts                  public barrel

demo/                       Vite multi-page demo + mock collector
build/                      tsup config → dist/analytics.js
tests/                      node --test suite (zero dependencies)
dist/                       build output (git-ignored)
```

There is no `adapters/` layer. The two probes live in `core/probes/`
and depend on the `EventRecorder` port; the wiring happens in the
**composition root** — your app — by naming them in `probes: [...]`
or handing them to `analytics.registerTracker()`. Either way the
engine never imports a probe, which is what keeps adding one a host
change rather than an engine change.
`tests/architecture.test.mjs` enforces this and a dozen other
invariants mechanically.

---

## The event pipeline

```
probe.track(name, props)
  → Analytics.track  → EventFactory.track  → createContext(session/url/referrer/UA)
      └─ debug: CREATED
  → EventQueue.enqueue (overflow drops the oldest + debug: FAILED)
      └─ debug: QUEUED → at batchSize or on the timer → flush()
  → flush(): peek a batch → debug: FLUSHING → destination.send
        accepted → out of the buffer
        refused  → dropped, one debug: FAILED · undeliverable
  → HttpDestination → POST JSON {events}, debug: SENT / FAILED
```

`visibilitychange` / `beforeunload` trigger a last flush, and so
does coming back online.

---

## Entry point

There is no `init()` and no auto-detection: you name the probes
you want, and the SDK wires them. `probes` takes factories:

```ts
import { Analytics } from "analytics";
import { PageTracker } from "analytics/core/probes/page-tracker";
import { ClickTracker } from "analytics/core/probes/click-tracker";

const analytics = new Analytics({
  endpoint: "/api/analytics/events",
  batchSize: 20,

  probes: [
    recorder => new PageTracker(recorder),
    recorder => new ClickTracker(recorder),
  ],
});

analytics.start();
```

**A factory, not a class.** A probe needs the recorder in its
constructor, and the recorder is the very object being
constructed — so `probes: [PageTracker]` could not work. Passing
a function also means options still reach the probe:
`recorder => new ClickTracker(recorder, { attribute: "data-tap" })`.

It also keeps the SDK ignorant of which probes exist. A
`probes: ["page", "click"]` shorthand would need a name-to-class
table inside the engine, and that table is the registry this
project deleted on purpose. `architecture.test.mjs` fails the
build if any engine file imports a probe.

**`probes` decides *what* is wired, never *when* it runs.**
Registering is all that happens; `start()` is still the call that
starts every registered probe, so a page view never fires from
inside a constructor.

Writing them by hand works too, and the two mix freely — useful
when a probe needs to be kept for later:

```ts
const click = new ClickTracker(analytics, { attribute: "data-tap" });
analytics.registerTracker(click);
```

`registerTracker()` only registers; `destroy()` and
`unregisterTracker()` stop probes; `await analytics.close()` is
the awaitable variant. See [Delivery & teardown](#delivery--teardown).

The barrel exports everything, so importing the root is all a
consumer needs:

```
analytics/index.ts    everything
```

Samples in this README write imports as `analytics/…` for brevity.
There is no package to install, so point them at wherever you keep
the sources — the demo uses a relative path.

### The two probes

| Probe | Constructor | Needs |
| --- | --- | --- |
| `PageTracker` | `new PageTracker(recorder)` | a DOM (reads `window.location`) |
| `ClickTracker` | `new ClickTracker(recorder, { attribute? })` | a DOM |

`ClickTracker` reports `Element Clicked` for any element carrying
`data-analytics="<name>"` (override the attribute name with
`{ attribute }`). The element's text is **not** reported unless it
also carries `data-analytics-text` — see [Privacy](#privacy).

`PageTracker` reports one `page` event when it starts, plus a
`Page Duration` when the tab is hidden or the page unloads.

**Idempotent by construction.** Both extend `BaseTracker`, which
owns the running flag. Subclasses implement `onStart()`/`onStop()`
and cannot double-register their listeners by accident — so
`start()` is safe to call more than once.

**Both probes are safe to construct and start without a DOM.**
A server render builds the whole chain and then has nothing to
listen to, so `canStart()` returns `hasDom()` and `start()`
leaves the probe stopped instead of throwing. The SDK can be
constructed, wired, started and destroyed anywhere; only
*recording* needs a browser.

### Privacy

`Element Clicked` carries the element's `textContent` only when the
element opts in with `data-analytics-text`. That is deliberate:
element text is the one property that routinely contains personal
data — a "Hi Sarah" greeting, a message preview, a price with the
customer's name beside it. The key is always present (`null` when
not opted in) so the property schema does not depend on which
element was clicked.

---

## Delivery & teardown

The queue ships a batch only once the destination accepted it:

```
track() → queued → flushing ──ok──▶ removed
                      │
                      └──fail──▶ dropped, one terminal
                                  "failed · undeliverable"
                                  debug event
```

| Option | Default | Meaning |
| --- | --- | --- |
| `endpoint` | — | required; where batches are POSTed |
| `batchSize` | `20` | events per request |
| `flushInterval` | `1000` | ms before an automatic flush |
| `timeoutMs` | `10000` | how long a request may be in flight; `0` disables it |
| `probes` | `[]` | probe factories to wire; see [Entry point](#entry-point) |
| `debug` | off | `{ enabled, console }`; see [Debug plugins](#debug-plugins) |
| `apiKey` / `headers` | — | extra auth / headers on the request |

The buffer holds 500 events and is **not configurable**. When it
is full the oldest event is dropped and reported as
`failed · queue-overflow` — a different reason from
`undeliverable`, because the event never left the buffer rather
than being refused by the destination. A cap you cannot raise
is a cap you cannot hit by accident.

**There is no retry.** A batch the destination refused is dropped
after one attempt, and reported as `failed · undeliverable` so the
loss is visible rather than silent. This is a deliberate trade:
buffering a refused batch means a permanently broken endpoint grows
the buffer and every later flush re-sends the same doomed payload.
If your events must survive a flaky network, ship them from the
host — `navigator.sendBeacon`, or your own queue in front of
`analytics.track()`.

An `online` event still flushes immediately: a page that was
offline buffered events nobody could ship, and connectivity coming
back is a fresh attempt at events that were never sent.

`flush()` never rejects — every automatic caller does
`void this.flush()`, so a rejection would surface as an unhandled
promise rejection.

A `flush()` that finds one already running hands back that same
promise instead of resolving at once, so `await flush()` really
means "the buffer has been dealt with" and not "a flush has been
scheduled". That is what makes `close()` trustworthy.

**Requests that never answer.** A black-holed route or a captive
portal leaves a request pending forever, which used to park the
queue on a promise that would never settle — no failure, no
report, event loss by silence. The transport now arms an
`AbortController` and treats `timeoutMs` as a failed attempt, so
the batch is dropped and reported instead of hanging. Set
`timeoutMs: 0` to opt out.

**`keepalive` is spent on the last request only.** Browsers cap how
much may be in flight that way at once, so spending it on ordinary
batches is how the one request that cannot be retried loses its slot.
Every flush therefore leaves it off except the tab-hidden /
`beforeunload` one. Bodies over ~60KB cannot use it either — those
are refused outright — so they go without rather than not at all.
`navigator.sendBeacon` is deliberately not used for that last
request: it reports success before knowing anything delivered, and
"did it arrive?" is the one thing that makes a loss reportable.

### Debug events

`emit()` points sit inside the engine, so a watch sees the whole
pipeline:

| Stage | When |
| --- | --- |
| `created` | the event object exists |
| `queued` | it is in the buffer |
| `flushing` | a request is in flight for it |
| `sent` | the destination accepted it |
| `failed` | it is gone — see the reason |

Four very different outcomes share `failed`, and only `reason`
tells them apart: `queue-overflow` (never left the buffer),
`undeliverable` (the destination refused it; no retry),
`transport-error` (the request itself failed) and `timeout`
(nothing was refused, the peer simply never answered). `error`
stays free-form and carries the message; match on `reason`.

Teardown releases everything the instance owns:

- `destroy()` — idempotent; stops every probe, removes its own
  `visibilitychange` / `beforeunload` listeners, stops the
  queue's timers and `online` listener, then makes one last
  best-effort flush.
- `close()` — the awaitable variant: flushes first, then stops, so
  nothing is left in flight.

---

## Debug plugins

Debug is a separate extension point from the probes: a plugin
observes the pipeline, a probe produces events. They are not two
names for the same thing, and they do not substitute for each
other.

`core/debug/` watches; it never participates in delivery. Its
`emit()` calls sit inside the engine (factory, queue, transport),
which is why a plugin can see events the host never sees.

```ts
import { CONSOLE_PLUGIN } from "analytics";

analytics.debug.registerDebugPlugin({
  name: "my-sink",
  onEvent(event) {
    if (event.stage === "sent") myCounter.increment();
  },
});

analytics.debug.debugPlugins;          // ["console", "my-sink"]
analytics.debug.unregisterDebugPlugin(CONSOLE_PLUGIN);
```

- **A plugin cannot break the page.** Each one is called inside
  its own try/catch: a throwing plugin used to propagate through
  `DebugController` and `EventFactory` into the host app's own
  click handler. It now warns once, and a plugin that fails three
  times in a row is unsubscribed (and dropped from `debugPlugins`)
  rather than called forever.
- **Every observer is named.** There is no anonymous
  `subscribe()`. A subscriber the registry cannot name is one
  `destroy()` cannot remove, so the name is the whole point — it
  is what makes the registry the only way in, and therefore
  exhaustive. This replaced a public event bus that kept its own
  listener set alongside the registry, where a bare
  `bus.subscribe(fn)` outlived the SDK it was watching.
- `destroy()` / `close()` release every plugin, so a host-registered
  plugin never outlives the SDK. A plugin's `stop()` runs inside a
  try/catch too, and its entry leaves the registry first — a
  teardown that throws cannot leave a detached plugin listed.

There is one built-in, and it is a plugin like any other,
installed by name:

| Name | Module | Notes |
| --- | --- | --- |
| `console` | `core/debug/console-plugin.ts` | stateless; the console logger |

`debug: { console: true }` therefore means "install this name",
and it can be removed the same way as a custom plugin. A host
plugin that already holds the name wins: the flag means "there
should be a console logger", not "install one over the top of
whatever is already there".

---

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
installs nothing.

One bundle comes out: `dist/analytics.js` — ESM, the library
entry, side-effect free. Importing it starts nothing; wiring the
probes is your decision.

No `.d.ts` is emitted: consumers get their types from the
TypeScript sources they import, the way the demo does. Emitting
declarations would need a typescript at the root, which is what
keeping the build in `build/` avoids.

**There is no `<script>` build.** There used to be a second
bundle that read a `window.analyticsOptions` global and installed
itself on `DOMContentLoaded`. It is gone, along with the whole
class of problems it brought: a second entry to keep out of the
barrel, a global name to document, a self-installing path nobody
could turn off, and a second artifact to test. A bundler is the
supported way to consume the SDK.

---

## Tests

```
npm --prefix tests install    # nothing to install
npm --prefix tests run test
```

- `tracker-port.test.mjs` — probes driven by a bare
  `EventRecorder`, no SDK instance; click text is opt-in
- `registry.test.mjs` — registration / teardown semantics, `probes`
  wiring (registered not started, options pass through, a throwing
  factory is skipped), listener
  counts, the end-to-end event pipeline
- `queue.test.mjs` — a refused batch is dropped and reported, the
  retry surface is gone, `flush()` never rejects, overflow drops
  the oldest, teardown clears every listener
- `debug-plugin.test.mjs` — plugins observe the whole pipeline,
  same-name registration replaces instead of doubling, unregister
  detaches silently
- `architecture.test.mjs` — the invariants below
- `robustness.test.mjs` — no `crypto.randomUUID`, storage disabled
  or absent, a throwing plugin, a request that never settles,
  `keepalive` gating, SSR construction, a concurrent `flush()`
  sharing one request, `close()` draining the buffer, plus unit
  tests for ids / factory / session / destination

### Invariants worth knowing

`architecture.test.mjs` states them mechanically, so a violation
fails the suite rather than being discovered later:

- probes import `core/api/tracker` only — never the `Analytics`
  facade, which is what keeps them testable in isolation
- no engine file imports a probe, so `probes` stays a list of
  factories and adding one is a host change, not an engine change
- nothing offers an anonymous debug subscription, so every
  observer is a name `destroy()` can reach
- nothing outside `core/probes` attaches a listener or a timer,
  apart from the three files that own theirs and pair every one
- the page triple (`pagePath` / `pageUrl` / `pageTitle`) is read
  from `domain/page-context.ts` and nowhere else
- importing the library starts nothing — no module may construct
  or listen at import time
- the SDK imports **no package at all** — only its own relative
  modules
- every listener the SDK registers can be removed again
- the root has no `package.json`, and `tests/` declares no
  dependencies

---

## Not provided on purpose

- **SPA route changes are not tracked.** `PageTracker` reads
  `window.location` once at start, so a client-side route change
  produces no second `page` event and no second `Page Duration`.
  This is a division of labour, not a gap: a framework's router
  already knows when a route settled, what its parameters were,
  and whether it was a back/forward navigation. An SDK patching
  the global History API to guess at that would be strictly less
  accurate — and it would be patching something it shares with
  every other library on the page.

  Report it from the router instead:

  ```ts
  // Angular
  router.events.pipe(filter(e => e instanceof NavigationEnd))
    .subscribe(() => analytics.page());

  // plain History API
  addEventListener("popstate", () => analytics.page());
  ```

  `page()` takes the path, so a router that knows more than the
  URL can say so — `analytics.page("/orders/42")`.
