import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser, observeDebug, sleep } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { Analytics } = require("./.build/core/api/analytics.js");
const { DebugController } = require("./.build/core/debug/debug-controller.js");

const config = {
  endpoint: "/api/analytics/events",
  batchSize: 1,
  flushInterval: 100000,
};

/**
 * Collect what `console.log` was called with.
 *
 * The console is the SDK's only sink, so its output is the only
 * thing a host gets — these assertions are about what a host
 * actually sees, not about an internal event object.
 */
async function captureConsole(body) {
  const original = console.log;
  const lines = [];

  console.log = (...args) => lines.push(args.join(" "));

  try {
    await body();
  } finally {
    console.log = original;
  }

  return lines;
}

// ---------------------------------------------------------------
// the one sink
// ---------------------------------------------------------------

test("the console reports every stage of the pipeline", async () => {
  env.reset();

  const analytics = new Analytics({
    ...config,
    debug: true,
  });

  const lines = await captureConsole(async () => {
    analytics.track("Signup");
    await analytics.flush();
  });

  assert.equal(lines.length, 4, "created/queued/flushing/sent");

  // The stage is the label, in colour, so a console full of
  // these is readable at a glance.
  assert.match(lines[0], /CREATED/);
  assert.match(lines[1], /QUEUED/);
  assert.match(lines[2], /FLUSHING/);
  assert.match(lines[3], /SENT/);

  // And the payload follows it, so one line answers "what".
  assert.match(lines[0], /Signup/);

  analytics.destroy();
});

test("a failure reports which of the four endings it was", async () => {
  env.reset();

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({ ok: false, status: 500 });

  try {
    const analytics = new Analytics({
      ...config,
      debug: true,
    });

    const lines = await captureConsole(async () => {
      analytics.track("Doomed");
      await analytics.flush();
    });

    // The reason rides along on the label. Without it a
    // "failed" line looks like every other failure, and the
    // reason is the half a machine can match on.
    assert.ok(
      lines.some((line) => /FAILED · transport-error/.test(line)),
      `expected a transport error among: ${lines.join(" | ")}`,
    );

    analytics.destroy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("console(false) silences it, and console(true) speaks up again", async () => {
  env.reset();

  const analytics = new Analytics({
    ...config,
    debug: true,
  });

  const on = await captureConsole(async () => {
    analytics.track("First");
    await analytics.flush();
  });

  assert.ok(on.length > 0);

  // The one runtime switch: a host that turned debug on for a
  // diagnostic can turn it back off when they are done.
  analytics.debug.console(false);

  const off = await captureConsole(async () => {
    analytics.track("Second");
    await analytics.flush();
  });

  assert.deepEqual(off, [], "no logging once the switch is off");

  // And it is reversible — this used to be a two-flag affair
  // where the flag decided whether the switch did anything, so
  // "off" and "not listening" were separate states.
  analytics.debug.console(true);

  const again = await captureConsole(async () => {
    analytics.track("Third");
    await analytics.flush();
  });

  assert.ok(again.length > 0, "console(true) brings it back");

  analytics.destroy();
});

test("nothing is reported unless debug is on", async () => {
  env.reset();

  const analytics = new Analytics(config);

  const seen = observeDebug(analytics.debug);

  const lines = await captureConsole(async () => {
    analytics.track("Quiet");
    await analytics.flush();
  });

  assert.deepEqual(lines, []);
  assert.deepEqual(seen, [], "not even the observer seam fires");

  // Off is the default. A shipped page should not narrate itself,
  // and the cost of getting that wrong is a console full of
  // stages nobody asked for.
  analytics.destroy();
});

test("console(true) on a controller that was off still switches it on", async () => {
  // The counterpart to the case above, and the reason the config
  // is one flag: a host that built without debug can turn it on
  // at runtime without rebuilding the SDK. With `{ enabled,
  // console }` this was impossible — `console: true` on a
  // never-enabled controller did nothing, and the two flags could
  // disagree with no way to say what that meant.
  const analytics = new Analytics(config);

  analytics.debug.console(true);

  const lines = await captureConsole(async () => {
    analytics.track("Late");
    await analytics.flush();
  });

  assert.ok(lines.length > 0, "the runtime switch is the only switch");

  analytics.destroy();
});

test("console(true) on an enabled controller is idempotent", () => {
  const debug = new DebugController(true);

  // The flag already installed it; asking again must not double
  // the output. It used to be able to, back when this was a
  // plugin registry keyed by name.
  debug.console(true);
  debug.console(true);

  const lines = [];
  const original = console.log;

  console.log = (...args) => lines.push(args.join(" "));

  try {
    debug.emit({
      stage: "created",
      context: { event: { name: "Once", properties: {} } },
      timestamp: 0,
    });
  } finally {
    console.log = original;
  }

  assert.equal(lines.length, 1);
});

// ---------------------------------------------------------------
// stop() — what replaced the registry teardown
// ---------------------------------------------------------------

test("stop() ends reporting and releases the observer", async () => {
  const debug = new DebugController(true);

  const seen = observeDebug(debug);

  debug.emit({
    stage: "created",
    context: { event: { name: "Before", properties: {} } },
    timestamp: 0,
  });

  assert.equal(seen.length, 1);

  debug.stop();

  assert.equal(
    debug.observe,
    undefined,
    "an observer must not outlive what it was observing",
  );

  const lines = [];
  const original = console.log;

  console.log = (...args) => lines.push(args.join(" "));

  try {
    debug.emit({
      stage: "created",
      context: { event: { name: "After", properties: {} } },
      timestamp: 0,
    });
  } finally {
    console.log = original;
  }

  assert.deepEqual(lines, [], "a stopped controller reports nothing");
  assert.equal(seen.length, 1, "and the observer saw nothing more");
});

test("destroy() stops reporting once the last flush settles", async () => {
  env.reset();

  const analytics = new Analytics({
    ...config,
    debug: true,
  });

  const seen = observeDebug(analytics.debug);

  analytics.track("Shipped");
  await analytics.flush();

  const before = seen.length;

  // `destroy()` is fire-and-forget; the stop lands in a
  // `.finally()` on the final flush.
  analytics.destroy();
  await sleep(20);

  assert.equal(analytics.debug.observe, undefined);

  await analytics.flush();

  assert.equal(seen.length, before, "nothing reported after destroy");
});

test("close() stops reporting before it resolves", async () => {
  env.reset();

  const analytics = new Analytics({
    ...config,
    debug: true,
  });

  const seen = observeDebug(analytics.debug);

  analytics.track("Shipped");

  // Unlike destroy(), close() is awaitable — so the assertion
  // needs no sleep, and that difference is the reason both
  // exist.
  await analytics.close();

  assert.equal(analytics.debug.observe, undefined);

  const after = seen.length;

  await analytics.flush();

  assert.equal(seen.length, after);
});
