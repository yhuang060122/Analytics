import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser, sleep } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { Analytics } = require("./.build/core/api/analytics.js");
const { PageTracker } = require("./.build/core/probes/page-tracker.js");
const { ClickTracker } = require("./.build/core/probes/click-tracker.js");
const { EventFactory } = require("./.build/core/factory/event-factory.js");
const { Session } = require("./.build/core/domain/session.js");
const { createId } = require("./.build/core/domain/id.js");
const { HttpDestination } = require(
  "./.build/core/transport/http-destination.js",
);
const { DebugController } = require(
  "./.build/core/debug/debug-controller.js",
);

/** v4 shape, including the version and variant nibbles. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

test("the session id survives a reload through sessionStorage", () => {
  Session.reset();

  const first = Session.current();

  assert.match(first.id, UUID);

  assert.equal(
    globalThis.sessionStorage.getItem("analytics.session"),
    first.id,
  );

  Session.reset();

  assert.equal(
    globalThis.sessionStorage.getItem("analytics.session"),
    null,
  );
});

test("createId() keeps producing uuids as crypto disappears", () => {
  const webcrypto = globalThis.crypto;

  // 1. the real thing
  assert.match(createId(), UUID);

  // 2. no randomUUID (http sites, sandboxed iframes)
  const noRandomUUID = swap("crypto", {
    getRandomValues: bytes => webcrypto.getRandomValues(bytes),
  });

  try {
    const ids = new Set();

    for (let i = 0; i < 20; i += 1) {
      const id = createId();

      assert.match(id, UUID, "getRandomValues branch");
      ids.add(id);
    }

    assert.equal(ids.size, 20, "no collisions");
  } finally {
    noRandomUUID();
  }

  // 3. no crypto at all
  const noCrypto = swap("crypto", undefined);

  try {
    const ids = new Set();

    for (let i = 0; i < 20; i += 1) {
      const id = createId();

      assert.match(id, UUID, "Math.random branch");
      ids.add(id);
    }

    assert.equal(ids.size, 20, "no collisions");
  } finally {
    noCrypto();
  }
});

test("no crypto.randomUUID (non-secure context) still tracks", () => {
  Session.reset();

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

test("the session falls back to memory instead of throwing", () => {
  const restore = swap("sessionStorage", undefined);

  try {
    Session.reset();

    const first = Session.current();

    // Stable for the page, which is the point: without this the
    // SDK would mint a new session id per event.
    assert.equal(Session.current().id, first.id);

    Session.reset();

    assert.notEqual(Session.current().id, first.id);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------
// debug plugins must not be able to break the host app
// ---------------------------------------------------------------

test("a throwing debug plugin does not reach track()", () => {
  const analytics = offlineAnalytics({ debug: { enabled: true } });

  const healthy = [];

  analytics.debug.registerDebugPlugin({
    name: "boom",
    onEvent() {
      throw new Error("plugin blew up");
    },
  });

  analytics.debug.registerDebugPlugin({
    name: "healthy",
    onEvent: event => healthy.push(event.stage),
  });

  assert.doesNotThrow(() => analytics.track("Signed up"));
  assert.equal(analytics.pending, 1);

  assert.ok(
    healthy.includes("created"),
    "one broken observer must not silence the others",
  );

  analytics.destroy();
});

test("a plugin that fails every time is eventually retired", () => {
  const analytics = offlineAnalytics({ debug: { enabled: true } });

  const healthy = [];

  analytics.debug.registerDebugPlugin({
    name: "healthy",
    onEvent: event => healthy.push(event.stage),
  });

  analytics.debug.registerDebugPlugin({
    name: "terminal",
    onEvent() {
      throw new Error("always");
    },
  });

  for (let i = 0; i < 6; i += 1) analytics.track("Signed up");

  assert.ok(
    !analytics.debug.debugPlugins.includes("terminal"),
    "a listener that fails every time is unsubscribed",
  );

  assert.ok(
    analytics.debug.debugPlugins.includes("healthy"),
    "an innocent plugin is never collateral damage",
  );

  analytics.destroy();
});

test("one failure does not retire a plugin", () => {
  const debug = new DebugController({ enabled: true });

  let calls = 0;

  debug.registerDebugPlugin({
    name: "warming-up",
    onEvent() {
      calls += 1;
      if (calls === 1) throw new Error("transient");
    },
  });

  const event = { stage: "created" };

  assert.doesNotThrow(() => {
    debug.emit(event);
    debug.emit(event);
  });

  assert.equal(calls, 2, "the plugin is still subscribed");

  // And a success resets the count, so a plugin that fails
  // early and then behaves is never retired by the accumulation.
  assert.deepEqual(debug.debugPlugins, ["warming-up"]);
});

test("a plugin that throws on unregister does not stay listed", () => {
  const debug = new DebugController({ enabled: true });

  debug.registerDebugPlugin({
    name: "bad-teardown",
    onEvent() {},
    stop() {
      throw new Error("teardown blew up");
    },
  });

  // The entry is removed before stop() runs, so a throwing
  // teardown cannot leave a detached plugin still advertised.
  assert.doesNotThrow(() => debug.unregisterDebugPlugin("bad-teardown"));
  assert.deepEqual(debug.debugPlugins, []);
});

test("every plugin is detached by destroy(), with no anonymous escape hatch", async () => {
  // The bus this replaced accepted anonymous subscribers, and
  // `teardown()` only walked the named registry — so a bare
  // `bus.subscribe(fn)` outlived the SDK it was observing. There
  // is no anonymous subscription any more, which makes the
  // registry the only way in and therefore exhaustive.
  const analytics = offlineAnalytics({ debug: { enabled: true } });

  const seen = [];

  analytics.debug.registerDebugPlugin({
    name: "watcher",
    onEvent: (event) => seen.push(event.stage),
  });

  analytics.track("Signed up");
  assert.ok(seen.length > 0, "the plugin saw the event");

  // `destroy()` is fire-and-forget: it tears plugins down inside
  // a `.finally()` on the last flush, so a plugin still sees the
  // final "sent". `close()` is the awaitable form, and this is
  // the one place the difference is observable.
  analytics.destroy();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(
    analytics.debug.debugPlugins,
    [],
    "destroy() must leave no plugin attached",
  );
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
    const debug = new DebugController({ enabled: true });

    const events = [];

    debug.registerDebugPlugin({
      name: "watcher",
      onEvent: event => events.push(event),
    });


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
  assert.match(one.event.id, UUID);
  assert.ok(!Number.isNaN(Date.parse(one.event.timestamp)));

  assert.equal(one.url, "http://x/p");
  assert.equal(one.referrer, null);
  assert.equal(one.userAgent, "node");
  assert.ok(one.sessionId);

  // Every event gets its own id, which is how a retrying queue
  // can be de-duplicated downstream.
  assert.notEqual(factory.track("Signed up").event.id, one.event.id);
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
// Session
// ---------------------------------------------------------------

test("the session id is stable across reads until reset", () => {
  Session.reset();

  const first = Session.current();

  assert.equal(Session.current().id, first.id);

  Session.reset();

  const second = Session.current();

  assert.notEqual(second.id, first.id);
  assert.equal(Session.current().id, second.id);
});

// ---------------------------------------------------------------
// HttpDestination
// ---------------------------------------------------------------

test("HttpDestination posts one batch with the configured headers", async () => {
  const seen = capture("fetch", async () => ({ ok: true, status: 200 }));

  try {
    const debug = new DebugController({ enabled: true });

    const destination = new HttpDestination(
      {
        endpoint: "/api/analytics/events",
        apiKey: "key-1",
        headers: { "X-Tenant": "acme" },
      },
      debug,
    );

    const sent = [];

    debug.registerDebugPlugin({
      name: "watcher",
      onEvent: event => sent.push(event),
    });


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

    assert.deepEqual(sent.map(e => e.stage), ["sent"]);
  } finally {
    seen.restore();
  }
});

test("a rejected request is reported as a transport error", async () => {
  const restore = swap("fetch", async () => ({ ok: false, status: 500 }));

  try {
    const debug = new DebugController({ enabled: true });

    const destination = new HttpDestination(
      { endpoint: "/api/analytics/events" },
      debug,
    );

    const sent = [];

    debug.registerDebugPlugin({
      name: "watcher",
      onEvent: event => sent.push(event),
    });


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
