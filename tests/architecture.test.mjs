import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.url.replace("file:///", ""), "..", "..");
const coreDir = join(root, "analytics", "core");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const importRe = /^\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/gm;
const requireRe = /require\(\s*["']([^"']+)["']\s*\)/g;

test("core never imports adapters (source)", () => {
  const offenders = walk(coreDir)
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(importRe)]
        .map((match) => ({ file, specifier: match[1] }))
        .filter((hit) => hit.specifier.includes("adapters")),
    );

  assert.deepEqual(offenders, [], "core must not depend on adapters");
});

test("core never requires adapters (compiled output)", () => {
  const buildDir = join(root, "tests", ".build", "core");

  if (!existsSync(buildDir)) {
    return; // run `npm test`, which builds first
  }

  const offenders = walk(buildDir)
    .filter((file) => file.endsWith(".js"))
    .flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(requireRe)]
        .map((match) => ({ file, specifier: match[1] }))
        .filter((hit) => hit.specifier.includes("adapters")),
    );

  assert.deepEqual(offenders, [], "compiled core must not require adapters");
});

test("adapters depend on the core port, not the Analytics class", () => {
  const adaptersDir = join(root, "analytics", "adapters");

  const bad = walk(adaptersDir)
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => !file.includes("angular"))
    .filter((file) => !file.includes("jquery"))
    .filter((file) => !file.includes("auto-track"))
    // adapters/index.ts is the composition root: it is
    // allowed to know the concrete Analytics class.
    .filter((file) => !file.endsWith(join("adapters", "index.ts")))
    .filter((file) =>
      /from\s+["'][^"']*core\/api\/(analytics|config)["']/.test(
        readFileSync(file, "utf8"),
      ),
    );

  assert.deepEqual(bad, [], "probes should import core/api/tracker only");
});

const adaptersDir = join(root, "analytics", "adapters");

/**
 * Comments legitimately mention framework names (transport
 * tags, usage examples), so only real import statements count.
 */
function codeOf(file) {
  const source = readFileSync(file, "utf8");

  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function importsOf(file) {
  return [...codeOf(file).matchAll(importRe)].map((match) => match[1]);
}

test("the public barrel never pulls in a framework adapter", () => {
  const barrelImports = importsOf(join(root, "analytics", "index.ts"));

  const offenders = barrelImports.filter((specifier) =>
    /adapters\/(jquery|angular)/.test(specifier),
  );

  assert.deepEqual(
    offenders,
    [],
    "importing 'analytics' must not drag jQuery or Angular into every app",
  );
});

test("framework adapters carry no package dependency", () => {
  const banned = /^(@angular\/|rxjs)/;

  const offenders = walk(adaptersDir)
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => importsOf(file).some((s) => banned.test(s)));

  assert.deepEqual(
    offenders,
    [],
    "Angular/rxjs must stay on the app side, or every stack needs them installed",
  );

  const jquery = codeOf(
    join(adaptersDir, "jquery", "jquery-ajax-tracker.ts"),
  );

  assert.doesNotMatch(
    jquery,
    /declare const \$/,
    "@types/jquery must not be forced onto consumers",
  );
});

test("network core stays framework-agnostic", () => {
  const imports = importsOf(
    join(adaptersDir, "network", "network-core.ts"),
  );

  assert.deepEqual(
    imports,
    ["../../core/api/tracker"],
    "network core may only depend on the core port",
  );
});

test("transport never depends on queue", () => {
  const transportDir = join(root, "analytics", "core", "transport");

  const offenders = walk(transportDir)
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) =>
      importsOf(file)
        .filter((specifier) => specifier.includes("queue"))
        .map((specifier) => `${file} → ${specifier}`),
    );

  assert.deepEqual(
    offenders,
    [],
    "queue drains through a Destination, so queue -> transport; the reverse drags EventQueue into the transport layer",
  );
});

test("every probe inherits BaseTracker instead of hand-rolling it", () => {
  const probes = [
    "browser/click-tracker.ts",
    "browser/page-tracker.ts",
    "browser/fetch-tracker.ts",
    "jquery/jquery-ajax-tracker.ts",
  ];

  probes.forEach((name) => {
    const source = readFileSync(join(adaptersDir, name), "utf8");

    assert.match(
      source,
      /extends BaseTracker/,
      `${name} must extend BaseTracker`,
    );

    assert.doesNotMatch(
      source,
      /private running/,
      `${name} must not manage the running flag itself`,
    );

    assert.doesNotMatch(
      source,
      /\bstart\(\): void/,
      `${name} must implement onStart(), not start()`,
    );
  });
});

test("shared types and constants are declared once", () => {
  const shared = ["DebugOptions", "STAGE_COLORS"];

  const files = walk(join(root, "analytics")).filter((file) =>
    file.endsWith(".ts"),
  );

  shared.forEach((name) => {
    // A re-export (`export type { X }`) is not a declaration.
    const pattern = new RegExp(
      `^\\s*(?:export\\s+)?(?:interface|type|const)\\s+${name}\\b`,
      "m",
    );

    const declaredIn = files.filter((file) =>
      pattern.test(readFileSync(file, "utf8")),
    );

    assert.equal(
      declaredIn.length,
      1,
      `${name} must have a single declaration, found ${declaredIn.length}`,
    );
  });
});

test("Analytics exposes the registry API", () => {
  const source = readFileSync(
    join(root, "analytics", "core", "api", "analytics.ts"),
    "utf8",
  );

  assert.match(source, /registerTracker\(/);
  assert.match(source, /unregisterTracker\(/);
  assert.match(source, /implements EventRecorder/);
  assert.doesNotMatch(source, /new AutoTrackManager\(/);
});

test("every listener the SDK registers can be removed again", () => {
  // Anonymous listeners were the reason a destroyed instance
  // kept flushing on every tab switch: there was no handle to
  // hand to removeEventListener.
  const sources = walk(join(root, "analytics", "core")).filter((file) =>
    file.endsWith(".ts"),
  );

  sources.forEach((file) => {
    const source = codeOf(file);

    const added = [...source.matchAll(
      /addEventListener\(\s*(\n\s*)?["']([^"']+)["']/g,
    )].map((match) => match[2]);

    const removed = [...source.matchAll(
      /removeEventListener\(\s*(\n\s*)?["']([^"']+)["']/g,
    )].map((match) => match[2]);

    added.forEach((type) => {
      assert.ok(
        removed.includes(type),
        `${file} registers "${type}" but never removes it`,
      );
    });
  });
});

test("the debug port is public", () => {
  // A plugin author cannot type `onEvent(event: DebugEvent)`
  // if these are not exported from the root barrel, and a
  // missing export is otherwise invisible until someone tries
  // to import it.
  const barrel = readFileSync(join(root, "analytics", "index.ts"), "utf8");

  assert.match(
    barrel,
    /export \* from "\.\/core\/debug"/,
    "the root barrel must export core/debug",
  );

  const debugIndex = readFileSync(
    join(coreDir, "debug", "index.ts"),
    "utf8",
  );

  ["debug-event", "event-bus", "plugin"].forEach((name) => {
    assert.match(
      debugIndex,
      new RegExp(`export \\* from "\\./${name}"`),
      `core/debug/index.ts must export ./${name}`,
    );
  });

  const controller = readFileSync(
    join(coreDir, "debug", "debug-controller.ts"),
    "utf8",
  );

  assert.match(controller, /registerDebugPlugin\(/);
  assert.match(controller, /unregisterDebugPlugin\(/);
});

test("built-in debug sinks live in their own modules", () => {
  // They used to be inline in DebugController, which is why
  // there was no way to add a third one.
  const controller = codeOf(
    join(coreDir, "debug", "debug-controller.ts"),
  );

  assert.doesNotMatch(
    controller,
    /new DebugInspector\(/,
    "the panel belongs to inspector-plugin.ts",
  );

  assert.doesNotMatch(
    controller,
    /console\.log\(/,
    "the logger belongs to console-plugin.ts",
  );

  assert.doesNotMatch(
    controller,
    /STAGE_COLORS/,
    "colour handling belongs to the plugins, not the facade",
  );
});

test("types are imported with import type", () => {
  // The SDK builds to CommonJS, so `verbatimModuleSyntax` (which
  // would catch this at compile time) cannot be enabled here —
  // hence this guard. The demo's tsconfig does enable it, and
  // these imports used to be its only remaining errors.
  // DebugController is deliberately absent: the composition
  // root constructs it, so it is a real value import there.
  const typeOnlyNames = [
    "AnalyticsContext",
    "AnalyticsEvent",
    "DebugEvent",
    "DebugOptions",
    "DebugPlugin",
    "Destination",
    "EventRecorder",
    "PipelineStage",
    "Tracker",
  ];

  const files = walk(join(root, "analytics")).filter((file) =>
    file.endsWith(".ts"),
  );

  const offenders = files.flatMap((file) =>
    // `import {` only: `import type {` does not match.
    [...codeOf(file).matchAll(/import\s*\{([^}]*)\}\s*from/g)].flatMap(
      (match) =>
        match[1]
          .split(",")
          .map((name) => name.trim().replace(/^type\s+/, ""))
          .filter((name) => typeOnlyNames.includes(name))
          .map((name) => `${file} → ${name}`),
    ),
  );

  assert.deepEqual(
    offenders,
    [],
    "a type-only import emits nothing at runtime; importing it as a value breaks bundlers that enforce verbatimModuleSyntax",
  );
});

test("npm test runs every test file", () => {
  // The script lists files explicitly (cmd.exe does not expand
  // globs), so a new file is silently skipped unless it gets
  // added there too.
  const testScript = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).scripts.test;

  const files = readdirSync(join(root, "tests")).filter((name) =>
    name.endsWith(".test.mjs"),
  );

  const missing = files.filter((name) => !testScript.includes(name));

  assert.deepEqual(
    missing,
    [],
    `add ${missing.join(", ")} to the test script, or it never runs`,
  );
});
