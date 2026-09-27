import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const {
  init,
  reset,
  registerDetectedAdapters,
  installAdapters,
  registerAdapter,
  unregisterAdapter,
  getAdapter,
  listAdapters,
} = require("./.build/adapters/index.js");

/**
 * A third-party adapter under test, with its call history.
 */
function fakePlugin(name, hooks = {}) {
  const calls = { starts: 0, stops: 0, lastOptions: null };

  return {
    calls,
    adapter: {
      name,
      available: hooks.available ?? (() => true),
      start(host, options) {
        calls.starts += 1;
        calls.lastOptions = options;
        if (hooks.start) return hooks.start(host, options);
      },
      stop() {
        calls.stops += 1;
      },
    },
  };
}

test("a third-party adapter registers, installs and receives its options", () => {
  reset();

  const plugin = fakePlugin("my-tracker");

  registerAdapter(plugin.adapter);

  const analytics = init({
    endpoint: "/api/analytics/events",
    adapters: { "my-tracker": { region: "eu" } },
  });

  assert.equal(plugin.calls.starts, 1);
  assert.deepEqual(plugin.calls.lastOptions, { region: "eu" });
  assert.ok(listAdapters().includes("my-tracker"));

  reset();
  assert.equal(plugin.calls.stops, 1, "reset() stops the adapter");

  unregisterAdapter("my-tracker");
});

test("init({ plugins }) registers and installs them", () => {
  reset();

  const plugin = fakePlugin("injected");

  init({
    endpoint: "/api/analytics/events",
    plugins: [plugin.adapter],
  });

  assert.equal(plugin.calls.starts, 1);
  assert.ok(listAdapters().includes("injected"));

  reset();
  unregisterAdapter("injected");
});

test("adapters: false disables, an unknown name is ignored", () => {
  reset();

  const plugin = fakePlugin("opt-out");

  registerAdapter(plugin.adapter);

  const analytics = init({
    endpoint: "/api/analytics/events",
    adapters: { "opt-out": false },
  });

  assert.equal(plugin.calls.starts, 0);

  const report = installAdapters(analytics, {
    adapters: { "opt-out": false },
  });

  assert.equal(report.adapters["opt-out"], "skipped");

  // A name that is not registered configures nothing, crashes nothing.
  const ghost = installAdapters(analytics, {
    adapters: { ghost: true },
  });

  assert.equal(ghost.adapters.ghost, undefined);

  reset();
  unregisterAdapter("opt-out");
});

test("an unavailable adapter reports unavailable", () => {
  reset();

  const plugin = fakePlugin("needs-thing", { available: () => false });

  registerAdapter(plugin.adapter);

  const analytics = init({ endpoint: "/api/analytics/events" });

  assert.equal(plugin.calls.starts, 0);

  const report = installAdapters(analytics, {});

  assert.equal(report.adapters["needs-thing"], "unavailable");

  reset();
  unregisterAdapter("needs-thing");
});

test("a throwing adapter does not break init()", () => {
  reset();

  const boom = {
    name: "boom",
    start() {
      throw new Error("boom");
    },
  };

  registerAdapter(boom);

  const analytics = init({ endpoint: "/api/analytics/events" });

  assert.ok(analytics, "init() must survive a broken adapter");

  const report = installAdapters(analytics, {});

  assert.equal(report.adapters.boom, "unavailable");

  reset();
  unregisterAdapter("boom");
});

test("same-name registration replaces the earlier adapter", () => {
  const first = fakePlugin("replace-me").adapter;
  const second = fakePlugin("replace-me").adapter;

  registerAdapter(first);
  assert.equal(getAdapter("replace-me"), first);

  registerAdapter(second);
  assert.equal(getAdapter("replace-me"), second);

  assert.equal(unregisterAdapter("replace-me"), true);
  assert.equal(getAdapter("replace-me"), undefined);
});

test("an integration reports manual while its runtime is present", async () => {
  reset();

  globalThis.angular = {};

  const analytics = init({ endpoint: "/api/analytics/events" });

  const report = await registerDetectedAdapters(analytics, {});

  assert.equal(report.angular, "manual");

  const integration = getAdapter("angular");

  assert.equal(typeof integration.create, "function");

  delete globalThis.angular;
  reset();
});

test("adapters.* wins over frameworks.* in both directions", async () => {
  reset();
  globalThis.window.fetch = globalThis.fetch;

  // frameworks says off, adapters says on -> on.
  const forcedOn = init({
    endpoint: "/api/analytics/events",
    frameworks: { fetch: false },
    adapters: { fetch: true },
  });

  assert.equal(
    (await registerDetectedAdapters(forcedOn, {})).fetch,
    "registered",
  );

  reset();
  globalThis.window.fetch = globalThis.fetch;

  // frameworks says on, adapters says off -> off.
  const forcedOff = init({
    endpoint: "/api/analytics/events",
    frameworks: { fetch: true },
    adapters: { fetch: false },
  });

  assert.equal(
    (await registerDetectedAdapters(forcedOff, {})).fetch,
    "skipped",
  );

  reset();
});
