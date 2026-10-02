import test from "node:test";
import assert from "node:assert/strict";
import { installBrowser, sleep } from "./browser-stub.mjs";

const env = installBrowser();
const require = env.require;

const { Analytics } = require("./.build/core/api/analytics.js");

const config = {
  endpoint: "/api/analytics/events",
  batchSize: 1,
  flushInterval: 100000,
};

/** A plugin is just a name and an onEvent callback. */
const plugin = (name, seen = []) => ({
  name,
  seen,
  onEvent(event) {
    seen.push(`${event.stage}:${event.context.event.name}`);
  },
});

test("a plugin observes the whole pipeline", async () => {
  env.reset();

  const analytics = new Analytics({ ...config, debug: { enabled: true } });
  const p = plugin("recorder");

  analytics.debug.registerDebugPlugin(p);

  analytics.track("Signup");

  await analytics.flush();
  await sleep(10);

  assert.deepEqual(p.seen, [
    "created:Signup",
    "queued:Signup",
    "flushing:Signup",
    "sent:Signup",
  ]);
});

test("registering the same name twice replaces instead of doubling", async () => {
  env.reset();

  const analytics = new Analytics({ ...config, debug: { enabled: true } });

  const first = plugin("recorder");
  const second = plugin("recorder");

  analytics.debug.registerDebugPlugin(first);
  analytics.debug.registerDebugPlugin(second);

  analytics.track("Signup");
  await analytics.flush();

  assert.deepEqual(first.seen, [], "the replaced plugin must go silent");
  assert.equal(second.seen.length, 4);
  assert.deepEqual(analytics.debug.debugPlugins, ["recorder"]);
});

test("unregisterDebugPlugin detaches by name", async () => {
  env.reset();

  const analytics = new Analytics({ ...config, debug: { enabled: true } });
  const p = plugin("recorder");

  analytics.debug.registerDebugPlugin(p);

  analytics.track("Before");
  await analytics.flush();

  assert.equal(analytics.debug.unregisterDebugPlugin("recorder"), true);
  assert.equal(
    analytics.debug.unregisterDebugPlugin("recorder"),
    false,
    "unregistering twice reports false",
  );

  analytics.track("After");
  await analytics.flush();

  assert.deepEqual(
    p.seen.filter((s) => s.endsWith(":After")),
    [],
    "no events after unregister",
  );
  assert.deepEqual(analytics.debug.debugPlugins, []);
});

test("the returned function unregisters too", async () => {
  env.reset();

  const analytics = new Analytics({ ...config, debug: { enabled: true } });
  const p = plugin("recorder");

  const off = analytics.debug.registerDebugPlugin(p);

  analytics.track("Before");
  await analytics.flush();

  off();

  analytics.track("After");
  await analytics.flush();

  assert.equal(p.seen.filter((s) => s.endsWith(":After")).length, 0);
  assert.deepEqual(analytics.debug.debugPlugins, []);
});

test("plugins stay silent while debug is disabled", async () => {
  env.reset();

  const analytics = new Analytics(config); // no debug.enabled
  const p = plugin("recorder");

  analytics.debug.registerDebugPlugin(p);

  analytics.track("Signup");
  await analytics.flush();

  assert.deepEqual(p.seen, [], "emit() is a no-op unless debug is enabled");
  assert.deepEqual(analytics.debug.debugPlugins, ["recorder"]);
});

test("two plugins with different names both receive events", async () => {
  env.reset();

  const analytics = new Analytics({ ...config, debug: { enabled: true } });

  const a = plugin("a");
  const b = plugin("b");

  analytics.debug.registerDebugPlugin(a);
  analytics.debug.registerDebugPlugin(b);

  analytics.track("Signup");
  await analytics.flush();

  assert.equal(a.seen.length, 4);
  assert.deepEqual(a.seen, b.seen);
  assert.deepEqual(analytics.debug.debugPlugins, ["a", "b"]);
});

/** Capture console.log while `body` runs. */
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

test("the built-in console logger is installed by name, not hardcoded", () => {
  env.reset();

  const analytics = new Analytics({
    ...config,
    debug: { enabled: true, console: true },
  });

  assert.deepEqual(analytics.debug.debugPlugins, ["console"]);

  // Which also means it can be removed like any plugin.
  assert.equal(analytics.debug.unregisterDebugPlugin("console"), true);
  assert.deepEqual(analytics.debug.debugPlugins, []);

  analytics.debug.console(true);
  assert.deepEqual(analytics.debug.debugPlugins, ["console"]);
});

test("a host plugin already holding the name is not overwritten", () => {
  env.reset();

  const analytics = new Analytics({
    ...config,
    debug: { enabled: true, console: true },
  });

  const mine = plugin("console");

  analytics.debug.unregisterDebugPlugin("console");
  analytics.debug.registerDebugPlugin(mine);

  // The flag means "there should be a console logger", not
  // "install one over the top of whatever is already there".
  analytics.debug.console(true);

  assert.deepEqual(analytics.debug.debugPlugins, ["console"]);

  analytics.track("Signup");
  assert.ok(
    mine.seen.length > 0,
    "the host's own console plugin must still be the one attached",
  );
});

test("the console plugin logs, and stops when unregistered", async () => {
  env.reset();

  const analytics = new Analytics({
    ...config,
    debug: { enabled: true, console: true },
  });

  const on = await captureConsole(async () => {
    analytics.track("Signup");
    await analytics.flush();
  });

  assert.equal(on.length, 4, "created/queued/flushing/sent");
  assert.match(on[0], /CREATED/);

  const off = await captureConsole(async () => {
    analytics.debug.unregisterDebugPlugin("console");
    analytics.track("Later");
    await analytics.flush();
  });

  assert.deepEqual(off, [], "no logging once the plugin is gone");
});

test("unregister runs the plugin's own teardown", async () => {
  env.reset();

  const analytics = new Analytics({ ...config, debug: { enabled: true } });

  let stopped = 0;
  analytics.debug.registerDebugPlugin({
    name: "owning-resources",
    onEvent: () => {},
    stop: () => (stopped += 1),
  });

  analytics.debug.unregisterDebugPlugin("owning-resources");

  assert.equal(stopped, 1);
});

test("destroy() tears plugins down once the last flush settles", async () => {
  env.reset();

  const analytics = new Analytics({
    ...config,
    debug: { enabled: true, console: true },
  });

  let stopped = 0;
  analytics.debug.registerDebugPlugin({
    name: "owning-resources",
    onEvent: () => {},
    stop: () => (stopped += 1),
  });

  analytics.track("Last");

  analytics.destroy();
  await sleep(20);

  assert.equal(stopped, 1, "destroy() must not leave a plugin attached");
  assert.deepEqual(analytics.debug.debugPlugins, []);
});

test("close() tears plugins down before it resolves", async () => {
  env.reset();

  const analytics = new Analytics({
    ...config,
    debug: { enabled: true, console: true },
  });

  let stopped = 0;
  analytics.debug.registerDebugPlugin({
    name: "owning-resources",
    onEvent: () => {},
    stop: () => (stopped += 1),
  });

  analytics.track("Last");

  await analytics.close();

  assert.equal(stopped, 1);
  assert.deepEqual(analytics.debug.debugPlugins, []);
});
