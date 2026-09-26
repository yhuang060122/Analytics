import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { ClickTracker } = require("./.build/adapters/browser/click-tracker.js");
const { PageTracker } = require("./.build/adapters/browser/page-tracker.js");

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
