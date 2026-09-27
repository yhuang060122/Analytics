import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { ClickTracker } = require("./.build/adapters/browser/click-tracker.js");
const { PageTracker } = require("./.build/adapters/browser/page-tracker.js");
const { FetchTracker } = require(
  "./.build/adapters/browser/fetch-tracker.js",
);
const { BaseTracker } = require("./.build/core/api/tracker.js");

function fakeRecorder() {
  const calls = [];
  return {
    calls,
    track: (name, properties) => calls.push({ method: "track", name, properties }),
    page: (path, properties) => calls.push({ method: "page", path, properties }),
  };
}

test("ClickTracker works against a bare EventRecorder (no Analytics)", () => {
  const recorder = fakeRecorder();
  const tracker = new ClickTracker(recorder);

  tracker.start();
  assert.equal(env.count("doc", "click"), 1);

  const element = {
    getAttribute: () => "Buy NVDA",
    tagName: "BUTTON",
    textContent: " Buy ",
    id: "buyBtn",
    className: "btn",
  };

  env.fire("doc", "click", {
    target: { closest: () => element },
  });

  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].name, "Element Clicked");
  assert.equal(recorder.calls[0].properties.element, "Buy NVDA");
  assert.equal(recorder.calls[0].properties.text, "Buy");

  tracker.stop();
  assert.equal(env.count("doc", "click"), 0);
});

test("ClickTracker.start() is idempotent", () => {
  const recorder = fakeRecorder();
  const tracker = new ClickTracker(recorder);

  tracker.start();
  tracker.start();
  tracker.start();

  assert.equal(env.count("doc", "click"), 1, "listeners must not stack");

  tracker.stop();
  tracker.stop();
  assert.equal(env.count("doc", "click"), 0);
});

test("PageTracker reports a page view on start", () => {
  const recorder = fakeRecorder();
  const tracker = new PageTracker(recorder);

  tracker.start();

  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].method, "page");
  assert.equal(recorder.calls[0].path, "/p");
  assert.equal(recorder.calls[0].properties.title, "demo");

  assert.equal(env.count("doc", "visibilitychange"), 1);
  assert.equal(env.count("win", "beforeunload"), 1);

  tracker.stop();
  assert.equal(env.count("doc", "visibilitychange"), 0);
  assert.equal(env.count("win", "beforeunload"), 0);
});

test("PageTracker.start() is idempotent", () => {
  const recorder = fakeRecorder();
  const tracker = new PageTracker(recorder);

  tracker.start();
  tracker.start();

  assert.equal(recorder.calls.length, 1, "no duplicate page event");
  assert.equal(env.count("doc", "visibilitychange"), 1);

  tracker.stop();
});

// --- BaseTracker: the guarantees every probe inherits ---

class Probe extends BaseTracker {
  constructor(gate = () => true) {
    super();

    this.starts = 0;
    this.stops = 0;
    this.gate = gate;
  }

  canStart() {
    return this.gate();
  }

  onStart() {
    this.starts += 1;
  }

  onStop() {
    this.stops += 1;
  }
}

const probe = (gate) => new Probe(gate);

test("BaseTracker calls onStart once no matter how often start() runs", () => {
  const tracker = probe();

  assert.equal(tracker.isRunning, false);

  tracker.start();
  tracker.start();
  tracker.start();

  assert.equal(tracker.starts, 1);
  assert.equal(tracker.isRunning, true);
});

test("BaseTracker ignores stop() before start()", () => {
  const tracker = probe();

  tracker.stop();
  tracker.stop();

  assert.equal(tracker.stops, 0);

  tracker.start();
  tracker.stop();
  tracker.stop();

  assert.equal(tracker.stops, 1);
  assert.equal(tracker.isRunning, false);
});

test("BaseTracker restart works after a stop", () => {
  const tracker = probe();

  tracker.start();
  tracker.stop();
  tracker.start();

  assert.equal(tracker.starts, 2);
  assert.equal(tracker.isRunning, true);
});

test("canStart() false leaves the tracker stopped, not half-started", () => {
  let present = false;

  const tracker = probe(() => present);

  tracker.start();

  assert.equal(tracker.starts, 0);
  assert.equal(tracker.isRunning, false, "must be startable later");

  present = true;
  tracker.start();

  assert.equal(tracker.starts, 1);
  assert.equal(tracker.isRunning, true);
});

test("FetchTracker restores window.fetch on stop", () => {
  globalThis.window.fetch = globalThis.fetch;

  const original = globalThis.window.fetch;

  const tracker = new FetchTracker(fakeRecorder());

  tracker.start();

  assert.notEqual(globalThis.window.fetch, original);

  tracker.stop();

  assert.equal(globalThis.window.fetch, original, "global must be restored");

  tracker.stop();

  assert.equal(globalThis.window.fetch, original);
});
