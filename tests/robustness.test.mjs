import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser, sleep } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { Analytics } = require("./.build/core/api/analytics.js");
const { EventFactory } = require("./.build/core/factory/event-factory.js");
const { Session } = require("./.build/core/domain/session.js");
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

function offlineAnalytics(overrides = {}) {
  return new Analytics({
    endpoint: "/api/analytics/events",
    // Long enough that no test is ever flushed by a timer:
    // every assertion here is about an explicit flush.
    flushInterval: 100000,
    ...overrides,
  });
}

// ---------------------------------------------------------------
// Robustness: the SDK must never break the host app
//
// The four cases below are the ones the SDK currently shares
// with the page instead of absorbing. They are marked `todo`
// because fixing them is the P0 round (id / session fallback,
// bus exception isolation, request timeout); the assertions
// describe the target behaviour, so they go green the moment
// that lands instead of being written from scratch then.
// ---------------------------------------------------------------

test(
  "no crypto.randomUUID (non-secure context) still tracks",
  { todo: true },
  () => {
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
  },
);

test("disabled sessionStorage still tracks", { todo: true }, () => {
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

  try {
    const analytics = offlineAnalytics();

    assert.doesNotThrow(() => analytics.track("Signed up"));
    assert.equal(analytics.pending, 1);

    analytics.destroy();
  } finally {
    restore();
  }
});

test("a throwing debug plugin does not reach track()", { todo: true }, () => {
  const analytics = offlineAnalytics({ debug: { enabled: true } });

  analytics.debug.registerDebugPlugin({
    name: "boom",
    onEvent() {
      throw new Error("plugin blew up");
    },
  });

  assert.doesNotThrow(() => analytics.track("Signed up"));
  assert.equal(analytics.pending, 1);

  analytics.destroy();
});

test("a request that never settles does not hang flush()", { todo: true }, async () => {
  const restore = swap("fetch", () => new Promise(() => undefined));

  try {
    const analytics = offlineAnalytics();

    analytics.track("Signed up");

    const outcome = await Promise.race([
      analytics.flush().then(() => "settled"),
      sleep(300).then(() => "hanging"),
    ]);

    assert.equal(outcome, "settled", "flush() must time out, not hang");

    analytics.destroy();
  } finally {
    restore();
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

  const context = factory.track("Signed up", { plan: "pro" });

  assert.equal(context.event.type, "track");
  assert.equal(context.event.name, "Signed up");
  assert.deepEqual(context.event.properties, { plan: "pro" });
  assert.match(context.event.id, /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(context.event.timestamp)));

  assert.equal(context.url, "http://x/p");
  assert.equal(context.referrer, null);
  assert.equal(context.userAgent, "node");
  assert.ok(context.sessionId);
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
  let seen = null;

  const restore = swap("fetch", async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200 };
  });

  try {
    const debug = new DebugController();

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

    debug.enable();

    const context = {
      sessionId: "s1",
      url: "http://x/p",
      referrer: null,
      userAgent: "node",
      event: { id: "e1", type: "track", name: "Signed up" },
    };

    // An empty batch is a no-op, not an empty POST.
    await destination.send([]);
    assert.equal(seen, null);

    await destination.send([context]);

    assert.equal(seen.url, "/api/analytics/events");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.keepalive, true);
    assert.deepEqual(seen.init.headers, {
      "Content-Type": "application/json",
      "X-API-Key": "key-1",
      "X-Tenant": "acme",
    });
    assert.deepEqual(JSON.parse(seen.init.body), { events: [context] });

    assert.deepEqual(sent.map(e => e.stage), ["sent"]);
  } finally {
    restore();
  }
});

test("a rejected request is reported as a transport error", async () => {
  const restore = swap("fetch", async () => ({ ok: false, status: 500 }));

  try {
    const debug = new DebugController();

    const destination = new HttpDestination(
      { endpoint: "/api/analytics/events" },
      debug,
    );

    const sent = [];

    debug.registerDebugPlugin({
      name: "watcher",
      onEvent: event => sent.push(event),
    });

    debug.enable();

    const context = {
      sessionId: "s1",
      url: "http://x/p",
      referrer: null,
      userAgent: "node",
      event: { id: "e1", type: "track", name: "Signed up" },
    };

    await assert.rejects(
      () => destination.send([context]),
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
