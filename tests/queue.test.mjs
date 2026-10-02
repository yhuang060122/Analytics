import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser, sleep } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { EventQueue } = require("./.build/core/queue/event-queue.js");
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

/** A destination that always fails. */
const failing = (sent = []) => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    get sent() {
      return sent;
    },
    async send() {
      calls += 1;
      throw new Error("HTTP 500");
    },
  };
};

/** A destination that records what it was handed. */
const ok = (sent = []) => {
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
      sent.push(...events);
    },
  };
};

const queueWith = (destination, options = {}) => {
  const debug = new DebugController({ enabled: true });
  const stages = [];
  const reasons = [];

  debug.registerDebugPlugin({
    name: "recorder",
    onEvent(e) {
      stages.push(`${e.stage}:${e.context.event.name}`);
      if (e.reason) reasons.push(e.reason);
    },
  });

  const queue = new EventQueue(destination, debug, {
    batchSize: 100,
    flushInterval: 100000,
    ...options,
  });

  return { queue, stages, reasons };
};

test("a refused batch is dropped, and reported rather than retried", async () => {
  env.reset();

  const destination = failing();
  const { queue, stages, reasons } = queueWith(destination);

  queue.enqueue(ctx("A"));

  await queue.flush();
  await sleep(60);

  assert.equal(
    destination.calls,
    1,
    "there is no retry: one attempt, then the batch is gone",
  );
  assert.equal(queue.size, 0, "a refused batch must not linger");

  // Dropping data is only acceptable if it is visible. With no
  // retry budget, the report IS the last word on the event.
  const failures = stages.filter((s) => s.startsWith("failed:"));
  assert.equal(failures.length, 1, "exactly one terminal failure is reported");
  assert.equal(reasons.at(-1), "undeliverable");

  queue.stop();
});

test("the queue has no retry surface left to configure", () => {
  env.reset();

  const { queue } = queueWith(ok());

  // `retrying` used to expose the retry timer. It is gone
  // rather than left returning false, because a getter that
  // can never be true is a lie a caller will eventually trust.
  assert.equal(
    "retrying" in queue,
    false,
    "a permanently-false retrying getter would be a lie",
  );

  queue.stop();
});

test("flush() never rejects, even when the destination always fails", async () => {
  env.reset();

  const destination = failing();
  const { queue } = queueWith(destination);

  queue.enqueue(ctx("A"));

  // `void this.flush()` callers used to turn this into an
  // unhandled rejection.
  await assert.doesNotReject(() => queue.flush());

  assert.equal(queue.size, 0, "the first failure drops the batch");

  queue.stop();
});

test("a full queue drops the oldest event instead of growing forever", () => {
  env.reset();

  const destination = ok();
  const { queue, stages, reasons } = queueWith(destination);

  // The cap is a constant now, so reaching it means 500
  // enqueues rather than four. Cheap enough, and it tests the
  // number that actually ships.
  const CAP = 500;

  for (let index = 0; index < CAP; index += 1) {
    queue.enqueue(ctx(`E${index}`));
  }

  queue.enqueue(ctx("Overflow"));

  assert.equal(queue.size, CAP, "the buffer never exceeds the cap");
  assert.equal(
    stages.includes("failed:E0"),
    true,
    "the oldest event is the one dropped",
  );
  assert.equal(
    stages.includes("queued:Overflow"),
    true,
    "the newest is the one kept",
  );

  // Overflow is a drop, not a request failure: it never left
  // the buffer, and a dashboard must be able to tell the two
  // apart without parsing the error string.
  assert.deepEqual(reasons, ["queue-overflow"]);

  queue.stop();
});

test("recovering connectivity flushes immediately", async () => {
  env.reset();

  const destination = ok();
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
  });

  analytics.track("Lost Event");

  await assert.doesNotReject(() => analytics.close());

  assert.equal(analytics.isDestroyed, true);
  assert.equal(analytics.pending, 0, "the buffer must not survive close()");

  globalThis.fetch = originalFetch;
});

test("a transport failure is tagged transport-error", async () => {
  env.reset();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  const analytics = new Analytics({
    endpoint: "/api/analytics/events",
    batchSize: 100,
    flushInterval: 100000,
    debug: { enabled: true },
  });

  const seen = [];
  analytics.debug.registerDebugPlugin({
    name: "seen",
    onEvent: (e) => seen.push(e),
  });

  analytics.track("Lost Event");
  await analytics.flush();

  // Two "failed" events for one loss, and that is the point:
  // the transport one says *why* the request failed, the
  // queue one says the batch was dropped. They used to be
  // indistinguishable without reading the message.
  const failures = seen.filter((e) => e.stage === "failed");

  assert.deepEqual(
    failures.map((e) => e.reason),
    ["transport-error", "undeliverable"],
  );

  globalThis.fetch = originalFetch;
  analytics.destroy();
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
