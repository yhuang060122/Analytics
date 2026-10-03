import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser, observeDebug, sleep } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { Analytics } = require("./.build/core/api/analytics.js");
const { PageTracker } = require("./.build/core/probes/page-tracker.js");
const { ClickTracker } = require("./.build/core/probes/click-tracker.js");
const { EventFactory } = require("./.build/core/factory/event-factory.js");
const { readSessionId } = require("./.build/core/domain/session-id.js");
const { HttpDestination } = require(
  "./.build/core/transport/http-destination.js",
);
const { DebugController } = require(
  "./.build/core/debug/debug-controller.js",
);

/**
 * Swap a global for the duration of a test.
 *
 * These globals are `configurable` (the stub installs crypto,
 * navigator and performance with defineProperty) but plain
 * assignment is enough for the rest, so both are handled.
 */
function swap(key, value) {
  const original = globalThis[key];

  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });

  return () =>
    Object.defineProperty(globalThis, key, {
      value: original,
      configurable: true,
      writable: true,
    });
}

/** Replace a global with something that records every call. */
function capture(key, impl) {
  let calls = null;

  const restore = swap(key, (...args) => {
    calls = args;
    return impl(...args);
  });

  return { seen: () => calls, restore };
}

function collectWarnings() {
  const original = console.warn;
  const warnings = [];

  console.warn = (...args) => warnings.push(args.join(" "));

  return {
    warnings,
    restore: () => (console.warn = original),
  };
}

/**
 * A request that never answers — but that does honour
 * `AbortSignal`, the way a real fetch does. Nothing ever aborts
 * a stub simply ignoring the signal.
 */
function hangForever() {
  return swap("fetch", (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    }),
  );
}

function offlineAnalytics(overrides = {}) {
  return new Analytics({
    endpoint: "/api/analytics/events",
    // Long enough that no test is ever flushed by a timer:
    // every assertion here is about an explicit flush.
    flushInterval: 100000,
    ...overrides,
  });
}

function context() {
  return {
    sessionId: "s1",
    url: "http://x/p",
    referrer: null,
    userAgent: "node",
    event: { id: "e1", type: "track", name: "Signed up" },
  };
}

// ---------------------------------------------------------------
// ids and sessions without the happy path
//
// Anything here used to throw straight out of init(), because
// the very first thing the SDK does is read a session id and
// build a page event.
// ---------------------------------------------------------------

test("the SDK reads the host's correlation id and never writes one", () => {
  env.reset();

  // Nothing written: no id, and the SDK does not fill the gap.
  assert.equal(readSessionId(), null);

  // The host writes; the SDK reads. One key, documented in
  // session-id.ts, and nothing else.
  globalThis.sessionStorage.setItem("analytics.session", "corr-abc");

  assert.equal(readSessionId(), "corr-abc");

  // The load-bearing half. An SDK that minted its own id would
  // report something here, and everything downstream would then
  // have two identifiers meaning "this visit" — a host one that
  // joins up in the backend and an SDK one that joins up nowhere.
  assert.equal(
    globalThis.sessionStorage.getItem("analytics.session"),
    "corr-abc",
    "reading must not rewrite the value it read",
  );
  assert.equal(
    readSessionId(),
    "corr-abc",
    "and reading twice must not have changed it either",
  );

  env.reset();
});

test("a blank correlation id reads as null, not as an empty group", () => {
  env.reset();

  // A host whose id turned out to be blank will happily write
  // "". Reporting that would be worse than reporting nothing: it
  // is a value, so a collector would group by it and merge every
  // such visit into one.
  globalThis.sessionStorage.setItem("analytics.session", "");

  assert.equal(readSessionId(), null);

  env.reset();
});

test("a late-written correlation id is picked up on the next event", () => {
  env.reset();

  const factory = new EventFactory(new DebugController());

  assert.equal(factory.track("Before login").sessionId, null);

  // The host logs in mid-visit and writes its id. A value latched
  // at construction — which is what the old in-memory session
  // effectively was — would keep reporting the absence until
  // reload, so the events either side of the login could not be
  // joined up on the server.
  globalThis.sessionStorage.setItem("analytics.session", "corr-late");

  assert.equal(factory.track("After login").sessionId, "corr-late");

  env.reset();
});

test("no crypto.randomUUID (non-secure context) still tracks", () => {
  const restore = swap("crypto", {});

  try {
    const analytics = offlineAnalytics();

    assert.doesNotThrow(() => analytics.track("Signed up"));
    assert.equal(analytics.pending, 1);

    analytics.destroy();
  } finally {
    restore();
  }
});

test("disabled sessionStorage still tracks, once warned", () => {
  const restore = swap("sessionStorage", {
    getItem() {
      throw new Error("SecurityError: storage disabled");
    },
    setItem() {
      throw new Error("SecurityError: storage disabled");
    },
    removeItem() {
      throw new Error("SecurityError: storage disabled");
    },
  });

  const logged = collectWarnings();

  try {
    const analytics = offlineAnalytics();

    analytics.track("Signed up");
    analytics.track("Signed up again");

    assert.equal(analytics.pending, 2);

    const relevant = logged.warnings.filter(w =>
      w.includes("sessionStorage"),
    );

    assert.equal(relevant.length, 1, "warn once, not per event");

    analytics.destroy();
  } finally {
    logged.restore();
    restore();
  }
});

test("no sessionStorage at all is a null id, not a minted one", () => {
  const restore = swap("sessionStorage", undefined);

  try {
    // SSR, or a runtime where storage was never exposed. The
    // answer is the honest one — there is no correlation id to
    // report — and it costs nothing: the payload has the key
    // either way, so a collector sees `null` rather than a gap.
    //
    // This case used to be the one that made the in-memory
    // fallback look necessary. It was not: the fallback existed
    // to give a *minted* id somewhere to live, and there is no
    // minted id left to keep.
    assert.equal(readSessionId(), null);

    const factory = new EventFactory(new DebugController());

    const tracked = factory.track("Signed up");

    assert.equal(tracked.sessionId, null);
    assert.equal(
      "sessionId" in tracked,
      true,
      "the key stays, so the schema does not change with the value",
    );
  } finally {
    restore();
  }
});

test("destroy() stops debug reporting, so nothing outlives the instance", async () => {
  // This is the assertion that used to read "destroy() must leave
  // no plugin attached", back when there was a registry to walk.
  // The leak it guarded was real: `teardown()` only walked the
  // named plugins, so an anonymous `bus.subscribe(fn)` outlived
  // the SDK it was watching. There is no registry now, and
  // `stop()` clears the one thing that could still be holding on.
  const analytics = offlineAnalytics({ debug: true });

  const seen = observeDebug(analytics.debug);

  analytics.track("Signed up");
  assert.ok(seen.length > 0, "the observer saw the event");

  // `destroy()` is fire-and-forget: it stops debug reporting
  // inside a `.finally()` on the last flush, so the final "sent"
  // is still reported. `close()` is the awaitable form, and this
  // is the one place the difference is observable.
  analytics.destroy();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const afterDestroy = seen.length;

  assert.equal(
    analytics.debug.observe,
    undefined,
    "destroy() must release the observer it was holding",
  );

  // And nothing can put events back: the engine that emits them
  // is gone, and the console switch is closed with it.
  analytics.flush();

  assert.equal(seen.length, afterDestroy);
});

// ---------------------------------------------------------------
// requests
// ---------------------------------------------------------------

test("a request that never settles times out instead of hanging", async () => {
  const restore = hangForever();

  try {
    const analytics = offlineAnalytics({ timeoutMs: 50 });

    analytics.track("Signed up");

    const outcome = await Promise.race([
      analytics.flush().then(() => "settled"),
      sleep(1000).then(() => "hanging"),
    ]);

    assert.equal(outcome, "settled", "flush() must time out, not hang");

    analytics.destroy();
  } finally {
    restore();
  }
});

test("a timeout is reported as a timeout, not a transport error", async () => {
  const restore = hangForever();

  try {
    const debug = new DebugController(true);

    const events = observeDebug(debug);


    const destination = new HttpDestination(
      { endpoint: "/api/analytics/events", timeoutMs: 30 },
      debug,
    );

    await assert.rejects(
      () => destination.send([context()]),
      /no response after 30 ms/,
    );

    const [failure] = events;

    assert.equal(failure.stage, "failed");
    assert.equal(failure.reason, "timeout");
  } finally {
    restore();
  }
});

test("keepalive is reserved for the unload flush", async () => {
  env.reset();

  const seen = capture("fetch", async () => ({ ok: true, status: 200 }));

  try {
    const analytics = offlineAnalytics();

    analytics.track("Signed up");
    await analytics.flush();

    assert.equal(
      seen.seen()[1].keepalive,
      false,
      "an ordinary batch must not spend the keepalive budget",
    );

    analytics.track("Signed up again");

    // Page is going away: this is the one request that cannot
    // be retried, so it asks to outlive the document.
    env.fire("win", "beforeunload");
    await analytics.flush();

    assert.equal(seen.seen()[1].keepalive, true);

    analytics.destroy();
  } finally {
    seen.restore();
  }
});

test("an oversized body goes without keepalive", async () => {
  const seen = capture("fetch", async () => ({ ok: true, status: 200 }));

  try {
    const destination = new HttpDestination(
      { endpoint: "/api/analytics/events" },
      new DebugController(),
    );

    const huge = context();

    huge.event = {
      id: "e1",
      type: "track",
      name: "Huge",
      properties: { blob: "x".repeat(70_000) },
    };

    await destination.send([huge], { keepalive: true });

    assert.equal(
      seen.seen()[1].keepalive,
      false,
      "chrome refuses these outright; asking anyway only loses the batch",
    );
  } finally {
    seen.restore();
  }
});

// ---------------------------------------------------------------
// Robustness the current code already has
// ---------------------------------------------------------------

test("the SDK can be constructed without a DOM (SSR)", () => {
  const restoreWindow = swap("window", undefined);
  const restoreDocument = swap("document", undefined);

  try {
    const analytics = offlineAnalytics();

    // Nothing here may touch window/document: no lifecycle
    // listeners, no online listener, no page read.
    assert.doesNotThrow(() => analytics.destroy());
  } finally {
    restoreDocument();
    restoreWindow();
  }
});

test("every probe survives construction and start without a DOM", () => {
  // This case used to stop at the facade, which is exactly why
  // PageTracker could read window.location in a field
  // initialiser for months: the suite was green because it
  // never built a probe on a runtime without a window.
  //
  // A server render constructs the whole chain — the probes
  // included — and then has nothing to listen to. So every step
  // has to be safe, and a probe with no DOM must end up stopped
  // rather than half-started.
  const restoreWindow = swap("window", undefined);
  const restoreDocument = swap("document", undefined);

  try {
    const analytics = offlineAnalytics();

    const page = new PageTracker(analytics);
    const click = new ClickTracker(analytics);

    assert.doesNotThrow(() => page.start(), "PageTracker.start()");
    assert.doesNotThrow(() => click.start(), "ClickTracker.start()");

    assert.equal(page.isRunning, false, "no DOM leaves it stopped");
    assert.equal(click.isRunning, false, "no DOM leaves it stopped");

    // And the whole chain at once, the way an app wires it.
    assert.doesNotThrow(() => {
      const fresh = offlineAnalytics();

      fresh.registerTracker(new PageTracker(fresh));
      fresh.registerTracker(new ClickTracker(fresh));
      fresh.start();
      fresh.destroy();
    });
  } finally {
    restoreDocument();
    restoreWindow();
  }
});

test("flush() hands the running flush to concurrent callers", async () => {
  let release = () => undefined;

  const gate = new Promise(resolve => (release = resolve));

  let calls = 0;

  const restore = swap("fetch", async () => {
    calls += 1;
    await gate;
    return { ok: true, status: 200 };
  });

  try {
    const analytics = offlineAnalytics();

    analytics.track("Signed up");

    const first = analytics.flush();

    assert.equal(
      analytics.flush(),
      first,
      "a concurrent flush must return the running promise, not a resolved one",
    );

    let settled = false;
    first.then(() => (settled = true));

    assert.equal(settled, false, "flush() settled before the request did");

    release();
    await first;

    assert.equal(settled, true);
    assert.equal(analytics.pending, 0, "buffer emptied");
    assert.equal(calls, 1, "one batch, one request");

    analytics.destroy();
  } finally {
    restore();
  }
});

test("close() resolves with nothing left buffered", async () => {
  const restore = swap("fetch", async () => ({ ok: true, status: 200 }));

  try {
    const analytics = offlineAnalytics();

    analytics.track("Signed up");
    analytics.track("Signed up again");

    await analytics.close();

    assert.equal(analytics.pending, 0);
    assert.equal(analytics.isDestroyed, true);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------
// EventFactory
// ---------------------------------------------------------------

test("track() builds the whole context, not just the event", () => {
  const factory = new EventFactory(new DebugController());

  const one = factory.track("Signed up", { plan: "pro" });

  assert.equal(one.event.type, "track");
  assert.equal(one.event.name, "Signed up");
  assert.deepEqual(one.event.properties, { plan: "pro" });
  assert.ok(!Number.isNaN(Date.parse(one.event.timestamp)));

  // No `id`: the collector assigns the primary key, and nothing
  // in this SDK ever read one.
  assert.equal(
    "id" in one.event,
    false,
    "an event carries no id — the server assigns that",
  );

  assert.equal(one.url, "http://x/p");
  assert.equal(one.referrer, null);
  assert.equal(one.userAgent, "node");

  // No id in this environment because the stub's storage is empty
  // and the SDK does not fill it in. Asserted as an exact null
  // rather than "falsy" so that a regression which quietly
  // restores minting shows up here as a failure, not as a pass.
  assert.equal(
    one.sessionId,
    null,
    "the SDK reports no id rather than inventing one",
  );

  // Two calls, two envelopes — but no per-event id. Compared by
  // name and length rather than by identity, because two events
  // created in the same millisecond would share a timestamp and
  // an identity check here would flake.
  const second = factory.track("Signed up");

  assert.notEqual(second, one, "a distinct object each call");
  assert.deepEqual(
    Object.keys(one.event).sort(),
    ["name", "properties", "timestamp", "type"],
    "and the payload shape is exactly these four keys",
  );
});

test("recording works without a DOM, and says so in the payload", () => {
  // `page()` used to take `path: string = window.location.pathname`
  // — a default is evaluated at the call site, so this reached for
  // `window` from inside the facade's `record()`, and a server
  // render dropped the event. Worse, the drop was reported by a
  // process-wide `warnOnce`, so every render after the first
  // failed the same way silently.
  // `location` as well as `window` / `document`: the browser stub
  // assigns `globalThis.location` separately, so swapping only
  // `window` would leave a location behind and the case would
  // pass for the wrong reason. In a real browser `window` *is*
  // the global object; the stub being laxer than that is the
  // thing that makes such a test lie.
  const restoreWindow = swap("window", undefined);
  const restoreDocument = swap("document", undefined);
  const restoreNavigator = swap("navigator", undefined);
  const restoreLocation = swap("location", undefined);

  try {
    const factory = new EventFactory(new DebugController());

    const tracked = factory.track("Signed up", { plan: "pro" });
    const paged = factory.page();

    // Both produce a real event rather than throwing.
    assert.equal(tracked.event.name, "Signed up");
    assert.equal(
      tracked.sessionId,
      null,
      "a session is not a browser thing, and this one is the host's",
    );

    // And the envelope is visibly empty rather than absent, so
    // a collector can tell "no browser" from "no data".
    assert.equal(tracked.url, "");
    assert.equal(tracked.userAgent, "");
    assert.equal(tracked.referrer, null);

    assert.equal(paged.event.type, "page");
    assert.equal(paged.event.name, "", "no path to read, no path invented");
    assert.deepEqual(paged.event.properties, { title: "" });
  } finally {
    restoreLocation();
    restoreNavigator();
    restoreDocument();
    restoreWindow();
  }
});

test("page() defaults to the current page and lets callers override", () => {
  const factory = new EventFactory(new DebugController());

  const explicit = factory.page("/watchlist", { title: "Watchlist" });

  assert.equal(explicit.event.type, "page");
  assert.equal(explicit.event.name, "/watchlist");
  assert.deepEqual(explicit.event.properties, { title: "Watchlist" });

  const implicit = factory.page();

  assert.equal(implicit.event.name, "/p");
  assert.deepEqual(implicit.event.properties, { title: "demo" });
});

// ---------------------------------------------------------------
// Session id
// ---------------------------------------------------------------

test("every read reflects what the host last wrote", () => {
  env.reset();

  // Reads are live, not latched. The host owns this value and may
  // change it at any point in the visit — a correlation id
  // arriving after a login is the ordinary case, not an edge one.
  assert.equal(readSessionId(), null);

  globalThis.sessionStorage.setItem("analytics.session", "first");
  assert.equal(readSessionId(), "first");

  globalThis.sessionStorage.setItem("analytics.session", "second");
  assert.equal(readSessionId(), "second");

  globalThis.sessionStorage.removeItem("analytics.session");
  assert.equal(readSessionId(), null, "and back to null once removed");

  env.reset();
});

// ---------------------------------------------------------------
// HttpDestination
// ---------------------------------------------------------------

test("HttpDestination posts one batch with the configured headers", async () => {
  const seen = capture("fetch", async () => ({ ok: true, status: 200 }));

  try {
    const debug = new DebugController(true);

    const destination = new HttpDestination(
      {
        endpoint: "/api/analytics/events",
        headers: {
          "X-Tenant": "acme",
          // Auth is just a header. There is no `apiKey`
          // shorthand: it would pick the header name, and
          // collectors do not all agree on one.
          "X-API-Key": "key-1",
        },
      },
      debug,
    );

    const sent = observeDebug(debug);


    const payload = context();

    // An empty batch is a no-op, not an empty POST.
    await destination.send([]);
    assert.equal(seen.seen(), null);

    await destination.send([payload]);

    const [url, init] = seen.seen();

    assert.equal(url, "/api/analytics/events");
    assert.equal(init.method, "POST");
    assert.equal(init.keepalive, false);
    assert.deepEqual(init.headers, {
      "Content-Type": "application/json",
      "X-API-Key": "key-1",
      "X-Tenant": "acme",
    });
    assert.deepEqual(JSON.parse(init.body), { events: [payload] });

    assert.deepEqual(sent.stages, ["sent:Signed up"]);
  } finally {
    seen.restore();
  }
});

test("a rejected request is reported as a transport error", async () => {
  const restore = swap("fetch", async () => ({ ok: false, status: 500 }));

  try {
    const debug = new DebugController(true);

    const destination = new HttpDestination(
      { endpoint: "/api/analytics/events" },
      debug,
    );

    const sent = observeDebug(debug);


    await assert.rejects(
      () => destination.send([context()]),
      /HTTP 500/,
      "the queue needs the rejection to keep the batch buffered",
    );

    const [failure] = sent;

    assert.equal(failure.stage, "failed");
    assert.equal(failure.reason, "transport-error");
    assert.match(failure.error, /HTTP 500/);
  } finally {
    restore();
  }
});
