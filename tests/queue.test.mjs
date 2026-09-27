import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser, sleep } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { EventQueue } = require("./.build/core/queue/event.queue.js");
const { DebugController } = require("./.build/core/debug/debug-controller.js");
const { Analytics } = require("./.build/core/api/analytics.js");

/** Build a minimal context; the queue never looks inside it. */
const ctx = (name) => ({
  sessionId: "s1",
  url: "http://x/p",
  referrer: null,
  userAgent: "node",
  event: {
    id: name,
    type: "track",
    name,
    properties: {},
    timestamp: new Date().toISOString(),
  },
});

/** A destination that fails `failTimes` times, then succeeds. */
const flaky = (failTimes, sent = []) => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    get sent() {
      return sent;
    },
    async send(events) {
      calls += 1;
      if (calls <= failTimes) throw new Error(`HTTP 500 (${calls})`);
      sent.push(...events);
    },
  };
};

const queueWith = (destination, options = {}) => {
  const debug = new DebugController({ enabled: true });
  const stages = [];
  debug.bus.subscribe((e) =>
    stages.push(`${e.stage}:${e.context.event.name}`),
  );

  const queue = new EventQueue(destination, debug, {
    batchSize: 100,
    flushInterval: 100000,
    retryDelay: 5,
    ...options,
  });

  return { queue, stages };
};

test("a failed batch stays buffered and is retried", async () => {
  env.reset();

  const destination = flaky(2);
  const { queue } = queueWith(destination, { maxRetries: 5 });

  queue.enqueue(ctx("A"));

  await queue.flush();

  assert.equal(destination.calls, 1);
  assert.equal(queue.size, 1, "a failed batch must not be dropped");
  assert.equal(queue.retrying, true, "a retry must be scheduled");

  await sleep(80);

  assert.equal(destination.calls, 3, "retries should have fired");
  assert.equal(queue.size, 0);
  assert.deepEqual(destination.sent.map((c) => c.event.name), ["A"]);

  queue.stop();
});

test("events are dropped only once the retry budget is spent", async () => {
  env.reset();

  const destination = flaky(999);
  const { queue, stages } = queueWith(destination, { maxRetries: 2 });

  queue.enqueue(ctx("A"));

  await queue.flush();
  assert.equal(queue.size, 1);

  await sleep(120);

  assert.equal(
    destination.calls,
    3,
    "initial attempt + 2 retries, then give up",
  );
  assert.equal(queue.size, 0, "the batch is dropped after the budget");

  const failures = stages.filter((s) => s.startsWith("failed:"));
  assert.equal(failures.length, 1, "exactly one terminal failure is reported");

  queue.stop();
});

test("flush() never rejects, even when the destination always fails", async () => {
  env.reset();

  const destination = flaky(999);
  const { queue } = queueWith(destination, { maxRetries: 0 });

  queue.enqueue(ctx("A"));

  // `void this.flush()` callers used to turn this into an
  // unhandled rejection.
  await assert.doesNotReject(() => queue.flush());

  assert.equal(queue.size, 0, "maxRetries 0 drops on the first failure");

  queue.stop();
});

test("a full queue drops the oldest event instead of growing forever", () => {
  env.reset();

  const destination = flaky(0);
  const { queue, stages } = queueWith(destination, {
    maxQueueSize: 3,
    maxRetries: 0,
  });

  queue.enqueue(ctx("A"));
  queue.enqueue(ctx("B"));
  queue.enqueue(ctx("C"));
  queue.enqueue(ctx("D"));

  assert.equal(queue.size, 3);
  assert.equal(stages.includes("failed:A"), true, "A was dropped");
  assert.equal(stages.includes("queued:D"), true, "D was kept");

  queue.stop();
});

test("recovering connectivity flushes immediately", async () => {
  env.reset();

  const destination = flaky(0);
  const { queue } = queueWith(destination);

  queue.enqueue(ctx("A"));
  assert.equal(destination.calls, 0);

  env.fire("win", "online");
  await sleep(20);

  assert.equal(destination.calls, 1);
  assert.equal(queue.size, 0);

  queue.stop();
});

test("close() flushes and never rejects when the endpoint is dead", async () => {
  env.reset();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  const analytics = new Analytics({
    endpoint: "/api/analytics/events",
    batchSize: 100,
    flushInterval: 100000,
    retryDelay: 5,
    maxRetries: 1,
  });

  analytics.track("Lost Event");

  await assert.doesNotReject(() => analytics.close());

  assert.equal(analytics.isDestroyed, true);
  assert.equal(analytics.retrying, false, "the retry timer must be cleared");

  globalThis.fetch = originalFetch;
});

test("a hidden tab after teardown does not flush", async () => {
  env.reset();

  const analytics = new Analytics({
    endpoint: "/api/analytics/events",
    batchSize: 100,
    flushInterval: 100000,
  });

  await analytics.close();

  env.fire("doc", "visibilitychange", {});

  assert.equal(env.batches.length, 0);
});
