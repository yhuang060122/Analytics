import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser, sleep } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { Analytics } = require("./.build/core/api/analytics.js");
const {
  ClickTracker,
} = require("./.build/core/probes/click-tracker.js");
const {
  PageTracker,
} = require("./.build/core/probes/page-tracker.js");

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

test("start() starts every registered tracker", () => {
  env.reset();

  const analytics = new Analytics(config);

  const started = [];
  analytics.registerTracker({
    start: () => started.push("a"),
    stop: () => {},
  });
  analytics.registerTracker({
    start: () => started.push("b"),
    stop: () => {},
  });

  analytics.start();

  assert.deepEqual(started, ["a", "b"]);
});

test("start() forwards to each tracker exactly once per call", () => {
  env.reset();

  const analytics = new Analytics(config);

  let starts = 0;
  analytics.registerTracker({
    start: () => (starts += 1),
    stop: () => {},
  });

  analytics.start();
  analytics.start();

  // Idempotency is the tracker's contract (BaseTracker), not
  // Analytics.start()'s — it simply forwards, so a plain object
  // is called once per start().
  assert.equal(starts, 2);
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
  analytics.debug.registerDebugPlugin({
    name: "stages",
    onEvent: (event) =>
      stages.push(`${event.stage}:${event.context.event.name}`),
  });

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

// ---------------------------------------------------------------
// config.probes — the same wiring, written as configuration
// ---------------------------------------------------------------

test("config.probes registers the probes without starting them", () => {
  env.reset();

  const starts = [];

  const analytics = new Analytics({
    ...config,
    probes: [
      () => ({ start: () => starts.push("a"), stop: () => {} }),
      () => ({ start: () => starts.push("b"), stop: () => {} }),
    ],
  });

  // The rule this option exists to keep: config decides *what*
  // is wired, never *when* it runs. A config that auto-started
  // would fire a page view from inside a constructor.
  assert.deepEqual(starts, [], "nothing may run before start()");

  analytics.start();
  assert.deepEqual(starts, ["a", "b"], "start() still starts them all");

  analytics.destroy();
});

test("a probe factory is handed the recorder, and needs nothing else", () => {
  env.reset();

  // The factory's only argument is the EventRecorder port — not
  // the Analytics class. That is what keeps a probe testable and
  // the SDK ignorant of which probes exist.
  let received;

  const analytics = new Analytics({
    ...config,
    probes: [
      (recorder) => {
        received = recorder;

        return { start() {}, stop() {} };
      },
    ],
  });

  assert.equal(typeof received.track, "function");
  assert.equal(typeof received.page, "function");

  // It is the live instance, so recording through it works.
  received.track("From the factory");
  assert.equal(analytics.pending, 1);

  analytics.destroy();
});

test("a probe factory may pass options through to its probe", () => {
  env.reset();

  const events = [];

  const analytics = new Analytics({
    ...config,
    // Debug has to be on for the observer below to see anything,
    // which is worth stating: a version of this test that read
    // the batches instead would have passed while asserting
    // nothing about which attribute matched.
    debug: { enabled: true },
    // The reason a factory is used instead of a class: options
    // still reach the probe constructor.
    probes: [
      recorder =>
        new ClickTracker(recorder, { attribute: "data-tap" }),
    ],
  });

  analytics.debug.registerDebugPlugin({
    name: "seen",
    onEvent: (e) => {
      if (e.stage === "created") events.push(e.context.event);
    },
  });

  analytics.start();

  // A `data-analytics` element, which is the DEFAULT attribute —
  // this probe was told to look for `data-tap` instead.
  env.fire("doc", "click", {
    target: {
      closest: (selector) =>
        selector.includes("data-analytics")
          ? {
              getAttribute: (name) => (name === "class" ? null : "Wrong"),
              hasAttribute: () => false,
              tagName: "BUTTON",
              textContent: "",
              id: "",
            }
          : null,
    },
  });

  // And the one it was told to look for.
  env.fire("doc", "click", {
    target: {
      closest: (selector) =>
        selector.includes("data-tap")
          ? {
              getAttribute: (name) =>
                name === "data-tap" ? "Tapped" : null,
              hasAttribute: () => false,
              tagName: "BUTTON",
              textContent: "",
              id: "",
            }
          : null,
    },
  });

  assert.deepEqual(
    events.map((e) => e.properties.element),
    ["Tapped"],
    "the custom attribute is the one that matched",
  );

  analytics.destroy();
});

test("a throwing factory is skipped, and the rest still register", () => {
  env.reset();

  const starts = [];

  const analytics = new Analytics({
    ...config,
    probes: [
      () => {
        throw new Error("cannot build this one");
      },
      () => ({ start: () => starts.push("survivor"), stop: () => {} }),
    ],
  });

  // The alternative — letting it out — is an exception from a
  // constructor, with a half-built instance attached to nothing.
  assert.doesNotThrow(() => analytics.start());

  assert.deepEqual(starts, ["survivor"]);

  analytics.destroy();
});

test("config.probes and hand-written probes mix", () => {
  env.reset();

  const analytics = new Analytics({
    ...config,
    probes: [recorder => new PageTracker(recorder)],
  });

  const click = new ClickTracker(analytics);

  analytics.registerTracker(click);
  analytics.start();

  assert.equal(click.isRunning, true);

  // And destroy() reaches both, which is the property that
  // makes the option safe to use.
  analytics.destroy();
  assert.equal(click.isRunning, false);
});
