import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser, sleep } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { Analytics } = require("./.build/core/api/analytics.js");
const {
  ClickTracker,
} = require("./.build/adapters/browser/click-tracker.js");
const {
  PageTracker,
} = require("./.build/adapters/browser/page-tracker.js");

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

test("directly registered probes wire and destroy() tears them down", () => {
  env.reset();

  const analytics = new Analytics(config);

  // Analytics registers its own lifecycle listeners too,
  // so assert on the delta the probes add.
  const before = {
    click: env.count("doc", "click"),
    vis: env.count("doc", "visibilitychange"),
    unload: env.count("win", "beforeunload"),
    online: env.count("win", "online"),
  };

  const page = new PageTracker(analytics);
  const click = new ClickTracker(analytics);

  page.start();
  click.start();

  analytics.registerTracker(page);
  analytics.registerTracker(click);

  assert.equal(env.count("doc", "click") - before.click, 1);
  assert.equal(env.count("doc", "visibilitychange") - before.vis, 1);
  assert.equal(env.count("win", "beforeunload") - before.unload, 1);

  analytics.destroy();

  assert.equal(env.count("doc", "click"), 0);

  // Analytics' own lifecycle listeners and the queue's
  // "online" listener are named fields, so destroy() can
  // remove them — nothing survives the teardown.
  assert.equal(env.count("doc", "visibilitychange"), 0);
  assert.equal(env.count("win", "beforeunload"), 0);
  assert.equal(env.count("win", "online"), 0);
});

test("destroy() is idempotent and silences the instance", () => {
  env.reset();

  const analytics = new Analytics(config);

  const click = new ClickTracker(analytics);
  click.start();
  analytics.registerTracker(click);

  analytics.destroy();
  analytics.destroy();

  assert.equal(analytics.isDestroyed, true);
  assert.equal(env.count("doc", "click"), 0);

  // Recording after teardown must not resurrect the pipeline.
  analytics.track("Ghost Event");
  assert.equal(analytics.pending, 0);

  // A hidden-tab flush after teardown does nothing either.
  env.fire("doc", "visibilitychange", {});
  assert.equal(env.batches.length, 0);
});

test("re-starting a probe does not stack listeners", () => {
  env.reset();

  const analytics = new Analytics(config);

  const click = new ClickTracker(analytics);
  click.start();
  analytics.registerTracker(click);

  click.start();
  click.start();

  assert.equal(env.count("doc", "click"), 1);

  analytics.destroy();
});

test("init() autoTrack switch still drives the registry adapters", () => {
  env.reset();

  const { init, reset } = require("./.build/adapters/index.js");

  // Analytics itself registers one visibilitychange and one
  // beforeunload (hidden-tab flush), so the PageTracker's own
  // listeners show up as a *second* registration of each.
  const analytics = init({
    endpoint: "/api/analytics/events",
    autoTrack: { click: true, page: false },
  });

  assert.equal(env.count("doc", "click"), 1);
  // page:false -> no PageTracker, so each lifecycle listener
  // appears exactly once (Analytics' own).
  assert.equal(env.count("doc", "visibilitychange"), 1);
  assert.equal(env.count("win", "beforeunload"), 1);

  analytics.destroy();
  reset();
});

test("event pipeline is unchanged: click -> queued -> flushing -> sent", async () => {
  env.reset();

  const analytics = new Analytics({
    ...config,
    batchSize: 1,
    debug: { enabled: true },
  });

  const click = new ClickTracker(analytics);
  click.start();
  analytics.registerTracker(click);

  const stages = [];
  analytics.debug.bus.subscribe((event) =>
    stages.push(`${event.stage}:${event.context.event.name}`),
  );

  const element = {
    getAttribute: () => "Buy NVDA",
    hasAttribute: () => false,
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

  // The page triple comes from the shared reader, not from the
  // probe reading window/document by hand.
  assert.equal(
    env.batches[0].events[0].event.properties.pagePath,
    "/p",
  );

  analytics.destroy();
});
