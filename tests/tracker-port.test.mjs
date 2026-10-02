import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { ClickTracker } = require("./.build/core/probes/click-tracker.js");
const { PageTracker } = require("./.build/core/probes/page-tracker.js");
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
    getAttribute: (name) =>
      name === "data-analytics-text" ? null : name === "class" ? "btn" : "Buy NVDA",
    // Opted in, so its text is reported.
    hasAttribute: (name) => name === "data-analytics-text",
    tagName: "BUTTON",
    textContent: " Buy ",
    id: "buyBtn",
  };

  env.fire("doc", "click", {
    target: { closest: () => element },
  });

  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].name, "Element Clicked");
  assert.equal(recorder.calls[0].properties.element, "Buy NVDA");
  assert.equal(recorder.calls[0].properties.text, "Buy");
  assert.equal(recorder.calls[0].properties.pagePath, "/p");

  tracker.stop();
  assert.equal(env.count("doc", "click"), 0);
});

test("click text is opt-in: no attribute, no textContent", () => {
  const recorder = fakeRecorder();
  const tracker = new ClickTracker(recorder);

  tracker.start();

  env.fire("doc", "click", {
    target: {
      closest: () => ({
        getAttribute: (name) =>
          name === "class" ? "btn" : "Buy NVDA",
        hasAttribute: () => false,
        tagName: "BUTTON",
        textContent: " Buy Sarah's order ",
        id: "buyBtn",
      }),
    },
  });

  const properties = recorder.calls[0].properties;

  // The key stays so the schema does not depend on the element.
  assert.equal(properties.text, null);
  assert.equal(
    JSON.stringify(properties).includes("Sarah"),
    false,
    "element text must not leave the page unless it is opted in",
  );

  tracker.stop();
});

test("cssClass is a plain string, whatever the element is", () => {
  const recorder = fakeRecorder();
  const tracker = new ClickTracker(recorder);

  tracker.start();

  // An SVG element's `className` is an SVGAnimatedString object,
  // so reading the property put a non-JSON value in the payload.
  // The attribute is a string for every element, which is why
  // that is what the probe reads.
  const svgClass = { baseVal: "icon" };

  env.fire("doc", "click", {
    target: {
      closest: () => ({
        getAttribute: (name) =>
          name === "class" ? "icon" : "Chart",
        hasAttribute: () => false,
        tagName: "svg",
        textContent: "",
        id: "",
        className: svgClass,
      }),
    },
  });

  const properties = recorder.calls[0].properties;

  assert.equal(properties.cssClass, "icon");
  assert.equal(typeof properties.cssClass, "string");
  assert.equal(
    JSON.stringify(properties).includes("baseVal"),
    false,
    "no part of an SVGAnimatedString may reach the payload",
  );

  // An element with no class at all reports null, not "".
  env.fire("doc", "click", {
    target: {
      closest: () => ({
        getAttribute: (name) => (name === "class" ? null : "Bare"),
        hasAttribute: () => false,
        tagName: "DIV",
        textContent: "",
        id: "",
      }),
    },
  });

  assert.equal(recorder.calls[1].properties.cssClass, null);

  tracker.stop();
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
