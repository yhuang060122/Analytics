import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser, sleep } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { Analytics } = require("./.build/core/api/analytics.js");
const {
  startAutoTrack,
  createBrowserAnalytics,
} = require("./.build/adapters/browser/auto-track.js");

const config = {
  endpoint: "/api/analytics/events",
  batchSize: 100,
  flushInterval: 100000,
};

test("registerTracker only registers, it does not start", () => {
  env.reset();

  const analytics = new Analytics(config);

  let started = false;
  analytics.registerTracker({
    start: () => (started = true),
    stop: () => {},
  });

  assert.equal(started, false);
  assert.equal(env.count("doc", "click"), 0);
});

test("destroy() stops every registered tracker", () => {
  env.reset();

  const analytics = new Analytics(config);

  let stopped = false;
  analytics.registerTracker({
    start: () => {},
    stop: () => (stopped = true),
  });

  analytics.destroy();
  assert.equal(stopped, true);
});

test("unregisterTracker stops the tracker and drops it", () => {
  env.reset();

  const analytics = new Analytics(config);

  let stopped = 0;
  const tracker = { start: () => {}, stop: () => (stopped += 1) };

  analytics.registerTracker(tracker);
  analytics.unregisterTracker(tracker);
  assert.equal(stopped, 1);

  analytics.destroy();
  assert.equal(stopped, 1, "must not be stopped twice");
});

test("startAutoTrack wires probes and destroy() tears them down", () => {
  env.reset();

  const analytics = new Analytics(config);

  // Analytics registers its own lifecycle listeners too,
  // so assert on the delta the probes add.
  const before = {
    click: env.count("doc", "click"),
    vis: env.count("doc", "visibilitychange"),
    unload: env.count("win", "beforeunload"),
  };

  analytics.registerTracker(
    startAutoTrack(analytics, { page: true, click: true, api: false }),
  );

  assert.equal(env.count("doc", "click") - before.click, 1);
  assert.equal(env.count("doc", "visibilitychange") - before.vis, 1);
  assert.equal(env.count("win", "beforeunload") - before.unload, 1);

  analytics.destroy();

  assert.equal(env.count("doc", "click"), 0);

  // Known gap (out of scope here): Analytics.removeLifecycle
  // does not exist yet, so its own two listeners survive
  // destroy(). Flip these to 0 once that lands.
  assert.equal(env.count("doc", "visibilitychange"), before.vis);
  assert.equal(env.count("win", "beforeunload"), before.unload);
});

test("re-starting an auto-track bundle does not stack listeners", () => {
  env.reset();

  const analytics = new Analytics(config);

  const bundle = startAutoTrack(analytics, { click: true, page: false });
  analytics.registerTracker(bundle);

  bundle.start();
  bundle.start();

  assert.equal(env.count("doc", "click"), 1);

  analytics.destroy();
});

test("createBrowserAnalytics keeps the legacy autoTrack config working", () => {
  env.reset();

  const analytics = createBrowserAnalytics({
    ...config,
    autoTrack: { click: true, page: false, api: false },
  });

  assert.equal(env.count("doc", "click"), 1);

  analytics.destroy();
  assert.equal(env.count("doc", "click"), 0);
});

test("event pipeline is unchanged: click -> queued -> flushing -> sent", async () => {
  env.reset();

  const analytics = new Analytics({
    ...config,
    batchSize: 1,
    debug: { enabled: true },
  });
  analytics.registerTracker(
    startAutoTrack(analytics, { page: false, click: true, api: false }),
  );

  const stages = [];
  analytics.debug.bus.subscribe((event) =>
    stages.push(`${event.stage}:${event.context.event.name}`),
  );

  const element = {
    getAttribute: () => "Buy NVDA",
    tagName: "BUTTON",
    textContent: "Buy",
    id: "buyBtn",
    className: "btn",
  };

  env.fire("doc", "click", { target: { closest: () => element } });

  await analytics.flush();
  await sleep(20);

  assert.deepEqual(stages, [
    "created:Element Clicked",
    "queued:Element Clicked",
    "flushing:Element Clicked",
    "sent:Element Clicked",
  ]);

  assert.equal(env.batches.length, 1);
  assert.equal(env.batches[0].events[0].event.name, "Element Clicked");

  analytics.destroy();
});
