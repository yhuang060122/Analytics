import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { NetworkTrackerCore, DEFAULT_IGNORE_URLS } = require(
  "./.build/adapters/network/network-core.js",
);
const { detectEnvironment, getJQuery, isJQueryAvailable } = require(
  "./.build/adapters/detect.js",
);
const { JQueryAjaxTracker } = require(
  "./.build/adapters/jquery/index.js",
);
const { createAnalyticsInterceptor, createAnalyticsHttpInterceptor } =
  require("./.build/adapters/angular/index.js");
const { init, getAnalytics, reset, registerDetectedAdapters } = require(
  "./.build/adapters/index.js",
);

function fakeRecorder() {
  const events = [];

  return {
    events,
    track: (name, properties) => events.push({ name, properties }),
    page: (path, properties) => events.push({ name: "page", properties }),
  };
}

const keysOf = (object) => Object.keys(object).sort().join(",");

// ---------------------------------------------------------------
// shared core
// ---------------------------------------------------------------

test("every transport emits the same event names and properties", () => {
  const shapes = ["fetch", "jquery", "angular"].map(transport => {
    const recorder = fakeRecorder();

    const core = new NetworkTrackerCore(recorder, { transport });

    core.record({
      method: "GET",
      url: "http://x/api/users?id=1",
      status: 200,
      durationMs: 12.4,
    });

    const [event] = recorder.events;

    return {
      name: event.name,
      keys: keysOf(event.properties),
      transport: event.properties.transport,
      url: event.properties.url,
    };
  });

  assert.deepEqual(
    shapes.map(s => s.name),
    ["API Request", "API Request", "API Request"],
  );

  assert.equal(
    new Set(shapes.map(s => s.keys)).size,
    1,
    "property shape must not vary per transport",
  );

  assert.deepEqual(
    shapes.map(s => s.transport),
    ["fetch", "jquery", "angular"],
  );

  assert.equal(shapes[0].url, "/api/users?id=1");
});

test("status decides success vs error identically everywhere", () => {
  const recorder = fakeRecorder();
  const core = new NetworkTrackerCore(recorder, { transport: "fetch" });

  core.record({ method: "GET", url: "/a", status: 200, durationMs: 1 });
  core.record({ method: "GET", url: "/a", status: 404, durationMs: 1 });
  core.record({ method: "GET", url: "/a", status: 0, durationMs: 1 });
  core.record({ method: "GET", url: "/a", status: 500, durationMs: 1 });

  assert.deepEqual(
    recorder.events.map(e => e.name),
    ["API Request", "API Error", "API Error", "API Error"],
  );
});

test("the SDK endpoint stays ignored even with custom ignoreUrls", () => {
  const core = new NetworkTrackerCore(fakeRecorder(), {
    ignoreUrls: ["/internal/health"],
  });

  assert.equal(core.shouldIgnore("/api/analytics/events"), true);
  assert.equal(core.shouldIgnore("/internal/health"), true);
  assert.equal(core.shouldIgnore("/api/users"), false);

  assert.ok(DEFAULT_IGNORE_URLS.includes("/api/analytics/events"));
});

// ---------------------------------------------------------------
// jQuery adapter
// ---------------------------------------------------------------

function installFakeJQuery() {
  const handlers = {};

  const collection = {
    ajaxSend: handler => (handlers.ajaxSend = handler),
    ajaxSuccess: handler => (handlers.ajaxSuccess = handler),
    ajaxError: handler => (handlers.ajaxError = handler),
    off: (event, handler) => {
      if (handlers[event] === handler) delete handlers[event];
    },
  };

  globalThis.jQuery = Object.assign(() => collection, { ajax: () => {} });

  return handlers;
}

function removeJQuery() {
  globalThis.jQuery = undefined;
  globalThis.$ = undefined;
}

test("jQuery adapter stays silent when jQuery is not loaded", () => {
  removeJQuery();

  const tracker = new JQueryAjaxTracker(fakeRecorder());

  assert.equal(tracker.available, false);
  assert.doesNotThrow(() => tracker.start());
  assert.doesNotThrow(() => tracker.stop());

  assert.equal(isJQueryAvailable(), false);
  assert.equal(getJQuery(), undefined);
});

test("jQuery adapter records $.ajax calls and tags the transport", () => {
  const handlers = installFakeJQuery();
  const recorder = fakeRecorder();

  const tracker = new JQueryAjaxTracker(recorder);

  assert.equal(tracker.available, true);

  tracker.start();

  const jqXHR = { status: 201 };

  handlers.ajaxSend({}, jqXHR, {});
  handlers.ajaxSuccess({}, jqXHR, {
    url: "/api/orders",
    type: "POST",
  });

  const [event] = recorder.events;

  assert.equal(event.name, "API Request");
  assert.equal(event.properties.transport, "jquery");
  assert.equal(event.properties.method, "POST");
  assert.equal(event.properties.url, "/api/orders");
  assert.equal(event.properties.status, 201);

  tracker.stop();

  assert.deepEqual(Object.keys(handlers), []);
});

test("jQuery adapter ignores the SDK endpoint", () => {
  const handlers = installFakeJQuery();
  const recorder = fakeRecorder();

  const tracker = new JQueryAjaxTracker(recorder);
  tracker.start();

  handlers.ajaxSuccess({}, { status: 200 }, {
    url: "/api/analytics/events",
  });

  assert.equal(recorder.events.length, 0);

  tracker.stop();
  removeJQuery();
});

// ---------------------------------------------------------------
// Angular adapter
// ---------------------------------------------------------------

class FakeObservable {
  constructor(subscribe) {
    this.subscribeFn = subscribe;
  }

  subscribe(observer) {
    this.subscribeFn(observer);
    return { unsubscribe: () => undefined };
  }
}

test("Angular interceptor records a response and forwards the stream", () => {
  const recorder = fakeRecorder();

  const interceptor = createAnalyticsInterceptor(recorder);

  const seen = [];

  const result = interceptor(
    { method: "GET", url: "/api/users", urlWithParams: "/api/users?x=1" },
    () =>
      new FakeObservable(observer => {
        observer.next({ type: 4, status: 200 });
        observer.complete();
      }),
  );

  result.subscribe({
    next: value => seen.push(value),
    error: () => undefined,
    complete: () => undefined,
  });

  assert.deepEqual(seen, [{ type: 4, status: 200 }]);

  const [event] = recorder.events;

  assert.equal(event.name, "API Request");
  assert.equal(event.properties.transport, "angular");
  assert.equal(event.properties.url, "/api/users?x=1");
  assert.equal(event.properties.status, 200);
});

test("Angular interceptor records errors and skips its own endpoint", () => {
  const recorder = fakeRecorder();

  const interceptor = createAnalyticsInterceptor(recorder);

  const request = { method: "POST", url: "/api/analytics/events" };

  interceptor(request, () => new FakeObservable(() => undefined));

  assert.equal(recorder.events.length, 0);

  const failing = createAnalyticsHttpInterceptor(recorder);

  let forwarded = null;

  failing
    .intercept({ method: "GET", url: "/api/orders" }, {
      handle: () =>
        new FakeObservable(observer => observer.error({ status: 503 })),
    })
    .subscribe({
      next: () => undefined,
      error: error => (forwarded = error),
      complete: () => undefined,
    });

  const [event] = recorder.events;

  assert.equal(event.name, "API Error");
  assert.equal(event.properties.status, 503);
  assert.deepEqual(forwarded, { status: 503 });
});

// ---------------------------------------------------------------
// detection + composition root
// ---------------------------------------------------------------

test("detection reports only what the runtime actually has", () => {
  removeJQuery();

  globalThis.window.fetch = globalThis.fetch;

  const bare = detectEnvironment();

  assert.equal(bare.jquery, false);
  assert.equal(bare.fetch, true);
  assert.equal(bare.angularjs, false);

  installFakeJQuery();
  globalThis.angular = {};

  const loaded = detectEnvironment();

  assert.equal(loaded.jquery, true);
  assert.equal(loaded.angularjs, true);

  delete globalThis.angular;
  removeJQuery();
});

test("init() is idempotent and registers fetch", async () => {
  reset();
  env.reset();

  globalThis.window.fetch = globalThis.fetch;
  const originalFetch = globalThis.window.fetch;

  const first = init({ endpoint: "/api/analytics/events" });
  const second = init({ endpoint: "/api/analytics/events" });

  assert.equal(first, second, "second init must not create a second SDK");
  assert.equal(getAnalytics(), first);

  assert.notEqual(
    globalThis.window.fetch,
    originalFetch,
    "fetch adapter should have patched window.fetch",
  );

  const report = await registerDetectedAdapters(first, {});

  assert.equal(report.jquery, "unavailable");

  first.destroy();
  reset();
});

test("registerDetectedAdapters wires jQuery only when present", async () => {
  reset();
  env.reset();

  globalThis.window.fetch = globalThis.fetch;

  const analytics = init({
    endpoint: "/api/analytics/events",
    network: false,
  });

  const absent = await registerDetectedAdapters(analytics, {});
  assert.equal(absent.jquery, "unavailable");

  installFakeJQuery();

  const present = await registerDetectedAdapters(analytics, {});
  assert.equal(present.jquery, "registered");

  const forcedOff = await registerDetectedAdapters(analytics, {
    frameworks: { jquery: false },
  });
  assert.equal(forcedOff.jquery, "skipped");

  analytics.destroy();
  reset();
  removeJQuery();
});
