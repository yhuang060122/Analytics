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

const probesDir = join(coreDir, "probes");

test("probes depend on the recorder port, not the Analytics class", () => {
  // The probes live inside core now, so nothing stops them
  // from reaching for the concrete facade — which would make
  // them untestable without a full SDK instance, and would tie
  // a listener to the whole pipeline. The port is the seam.
  const bad = walk(probesDir)
    .filter((file) => file.endsWith(".ts"))
    .filter((file) =>
      /from\s+["'][^"']*api\/(analytics|config)["']/.test(
        readFileSync(file, "utf8"),
      ),
    );

  assert.deepEqual(
    bad,
    [],
    "a probe should import core/api/tracker only — that is the whole seam",
  );
});

test("the engine never names a concrete probe", () => {
  // `config.probes` takes factories, not classes, precisely so
  // this stays true. Were it `probes: ["page", "click"]`, the
  // SDK would need a name -> class table, and that table is the
  // registry this project deleted on purpose: the engine would
  // know which probes exist, and adding one would be an engine
  // change rather than a host change.
  //
  // The host names the probe; the SDK only calls something that
  // returns a Tracker. So no engine file may *import* a probe.
  //
  // Imports, not mentions: `config.ts` and `tracker.ts` both show
  // `new PageTracker(recorder)` in their documentation, and that
  // is the opposite of a dependency — it is the recipe the host
  // is meant to copy. Comments are stripped by `codeOf()` below.
  // Matching on the specifier, not the class name: an import
  // reads `from "../probes/page-tracker"`, and the class name is
  // in the braces, not the path.
  const offenders = walk(join(coreDir, "api"))
    .filter((file) => file.endsWith(".ts"))
    .filter((file) =>
      importsOf(file).some((specifier) => /(^|\/)probes(\/|$)/.test(specifier)),
    )
    .map((file) => file.slice(root.length + 1));

  assert.deepEqual(
    offenders,
    [],
    "core/api must wire probes through factories, never by name — a name would mean an engine-side registry",
  );
});

test("nothing outside core/probes listens to the page", () => {
  // What used to be the adapters/ layer is gone, so the rule
  // has to be stated positively: probes are the only place
  // that may attach a listener. Anywhere else doing it would
  // be a listener the SDK cannot detach on destroy().
  const listeners = walk(coreDir)
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => !file.startsWith(probesDir))
    .filter((file) =>
      /(addEventListener|setTimeout|setInterval)\s*\(/.test(
        readFileSync(file, "utf8"),
      ),
    )
    .map((file) => file.slice(coreDir.length + 1));

  // The three that remain are all deliberate and all paired:
  // the facade's visibilitychange/beforeunload (removed in
  // removeLifecycle), the queue's flush timers (stopped in
  // stop()), and the transport's abort timer (cleared in a
  // finally). A fourth file appearing here is the bug.
  assert.deepEqual(
    listeners.map((file) => file.replace(/\\/g, "/")).sort(),
    [
      "api/analytics.ts",
      "queue/event-queue.ts",
      "transport/http-destination.ts",
    ],
    "outside probes, only the facade's lifecycle listeners, the queue's timers and the transport's abort timer may exist — each one paired",
  );
});

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

test("the SDK imports no runtime package at all", () => {
  // This used to be a jQuery-specific rule, and it earned its
  // keep: it is what stopped `import $ from "jquery"` and a
  // `declare const $` from reaching consumers. Every adapter
  // that could have carried a dependency is gone, so the rule
  // is now absolute — which is the version that cannot rot. A
  // future probe that reaches for a package fails here instead
  // of quietly making every consumer install it.
  const offenders = walk(join(root, "analytics"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({
      file: file.slice(root.length + 1),
      external: importsOf(file).find((specifier) => !specifier.startsWith(".")),
    }))
    .filter((hit) => hit.external !== undefined)
    .map((hit) => `${hit.file} → ${hit.external}`);

  assert.deepEqual(
    offenders,
    [],
    "the SDK is a directory of sources, not a package: it must import nothing but its own relative modules",
  );
});


test("the SDK mints no identifier of its own", () => {
  // Three things have been deleted from this SDK for the same
  // reason, and that reason is worth enforcing rather than
  // re-deriving: an identifier is only worth minting if something
  // reads it. `createId` and `AnalyticsEvent.id` went when the
  // retry that would have de-duplicated on one went; the session
  // id went when it was agreed the backend issues correlation
  // ids, so a second client-minted one does not join anything.
  //
  // Without a rule, the next person reads `timestamp` next to
  // `sessionId`, assumes an id belongs there, and adds one back
  // in good faith. The failure is invisible: a client-minted id
  // is well-formed, unique, and correlates with nothing.
  const offenders = walk(join(root, "analytics"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => {
      const code = codeOf(file);

      const mints =
        // randomUUID, getRandomValues, and the naive shape
        /\b(randomUUID|getRandomValues)\s*\(/.test(code);

      // Math.random() reaches for entropy for the same reason.
      const entropy = /\bMath\s*\.\s*random\s*\(/.test(code);

      // And writing to storage is the other half of minting: a
      // value the SDK persists is a value it decided on.
      const writes = /sessionStorage\s*\.\s*(setItem|removeItem|clear)\s*\(/.test(
        code,
      );

      return {
        file: file.slice(root.length + 1),
        mints: mints || entropy || writes,
      };
    })
    .filter((hit) => hit.mints)
    .map((hit) => hit.file);

  assert.deepEqual(
    offenders,
    [],
    "no module may mint an id or write to sessionStorage: the backend issues correlation ids, and the SDK only reads what the host wrote",
  );
});

test("page context is read from one module", () => {
  // The click probe used to spell out pagePath/pageUrl/pageTitle
  // by hand while another probe read them from a helper, so the
  // two halves could drift apart. Nothing outside
  // domain/page-context.ts may carry the full triple.
  //
  // "Carry" means spell it out, not read it. A file that calls
  // `readPageContext()` and uses what it returns is exactly what
  // this rule asks for — the factory does that in three places,
  // and it was flagged here before the rule learned the
  // difference. So the check looks for the three names as object
  // keys of a literal or a type, which is what "writing its own"
  // actually looks like.
  const TRIPLE = ["pagePath", "pageUrl", "pageTitle"];

  const offenders = walk(join(root, "analytics"))
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => !file.endsWith(join("domain", "page-context.ts")))
    .flatMap((file) => {
      const code = codeOf(file);

      // Read the triple from a literal this file defines, not
      // from a call it makes.
      const ownLiteral = new RegExp(
        `\\{\\s*(?:[^{}]*,\\s*)?${TRIPLE[0]}\\s*:`,
      ).test(code);

      const ownType = new RegExp(
        `(?:interface|type)\\s+\\w+[^{]*\\{[^}]*\\b${TRIPLE[1]}\\s*:`,
        "s",
      ).test(code);

      return ownLiteral || ownType ? [file.slice(root.length + 1)] : [];
    });

  assert.deepEqual(
    offenders,
    [],
    "call readPageContext(); do not define your own pagePath/pageUrl/pageTitle",
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
    "click-tracker.ts",
    "page-tracker.ts",
  ];

  probes.forEach((name) => {
    const source = readFileSync(join(probesDir, name), "utf8");

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
  // `DebugOptions` used to be here. It is gone: the config is a
  // boolean now, so there was no second flag left to describe.
  const shared = ["STAGE_COLORS"];

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

test("the debug vocabulary is public, the machinery is not", () => {
  // A host reads console output and matches on the stage names
  // and the failure reasons, so those three types have to be
  // importable. What it cannot have is a way to register a
  // sink: there is one sink, and it is the console.
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

  ["DebugEvent", "DebugFailureReason", "PipelineStage"].forEach((name) => {
    assert.match(
      debugIndex,
      new RegExp(`export type \\{[^}]*\\b${name}\\b`),
      `core/debug/index.ts must export the ${name} type`,
    );
  });

  assert.doesNotMatch(
    debugIndex,
    /export \* from/,
    "the debug barrel names its exports; it must not blanket-re-export",
  );

  // The registry is gone, and these are the three ways it could
  // come back. Each one is a name a host could hold that
  // `stop()` would then have to find.
  // `codeOf`, not readFileSync: the controller's comment explains
  // at length why the registry went away, and naming it there is
  // documentation, not a way back in.
  const controller = codeOf(
    join(coreDir, "debug", "debug-controller.ts"),
  );

  ["registerDebugPlugin", "debugPlugins", "readonly bus"].forEach((name) => {
    assert.doesNotMatch(
      controller,
      new RegExp(name),
      `${name} is how a subscriber outlives destroy(); the console is the only sink`,
    );
  });
});

test("the test sink replaces the console rather than joining it", () => {
  // 37 tests read `stage` and `reason` off the observe hook, and
  // the console formats those for a human. If both sinks ran, each
  // of them would also have to swallow the log output — which is
  // why `observe` is a replacement, not a second subscriber.
  const controller = codeOf(
    join(coreDir, "debug", "debug-controller.ts"),
  );

  assert.match(
    controller,
    /if\s*\(this\.observe\)\s*\{[\s\S]*?return;/,
    "an assigned observe must short-circuit, or every observer test also logs",
  );

  // And the config stays a boolean. Two flags for one sink is the
  // shape this replaced; a second option field would bring it
  // back with a meaning attached.
  const config = readFileSync(join(coreDir, "api", "config.ts"), "utf8");

  assert.match(
    config,
    /debug\?:\s*boolean;/,
    "debug must be one boolean — the console is the only sink",
  );

  assert.doesNotMatch(
    config,
    /interface\s+DebugOptions/,
    "a second flag for one sink is a decision with nowhere to go",
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

test("the library entry starts nothing on import", () => {
  // The self-installing `<script>` build is gone, so this is no
  // longer about one entry staying out of the barrel — every
  // file in the SDK is now reachable from it. The promise is
  // the same one that build made: importing the library must
  // not start tracking, because wiring the probes is the
  // caller's decision and only the caller's.
  //
  // What would break it is a module-level side effect: a
  // tracker constructed at import time, a listener attached, a
  // `new Analytics(...)` with a hardcoded endpoint. Any of
  // those would fire for a consumer who only wanted the class.
  // Module scope only: a `new Analytics(...)` inside a method
  // is the class doing its job, one at the top level is the
  // module doing work for whoever imported it. Comments and
  // type annotations are stripped first, and only lines that
  // are not inside a body are considered — which is what
  // indentation tells us.
  const topLevelStatements = (file) =>
    codeOf(file)
      .split("\n")
      .filter((line) => line.trim() && !/^[ \t]/.test(line));

  const offenders = walk(join(root, "analytics"))
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => !file.endsWith("index.ts"))
    .flatMap((file) => {
      const top = topLevelStatements(file).join("\n");

      // Constructing is only a side effect when the object
      // does something on construction. `new Set()` to hold
      // module state allocates and nothing else — warn.ts is
      // built entirely that way — so the check is for the
      // SDK's own classes, each of which wires itself to
      // something on the way out.
      const constructs =
        /^(?:export\s+)?(?:const|let|var)\s+\w+[^=]*=\s*new\s+(?:Analytics|ClickTracker|PageTracker|DebugController|EventQueue|HttpDestination|EventFactory)\b/m.test(top);

      const listens =
        /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*\w+\.(?:addEventListener|setTimeout|setInterval)\b/m.test(top);

      const bareCall = /^(?:addEventListener|setTimeout|setInterval)\s*\(/m.test(top);

      return constructs || listens || bareCall
        ? [`${file.slice(root.length + 1)}`]
        : [];
    });

  assert.deepEqual(
    offenders,
    [],
    "no module may construct or listen at import time; the SDK starts when the host says so",
  );
});

test("only the two islands install anything", () => {
  // There is no package.json at the root at all: it used to
  // hold nothing but scripts and an exports map nobody
  // consumed, and its mere presence invited dependencies
  // back in. demo/ owns the toolchain, build/ owns the
  // bundler, tests/ owns the test script and installs
  // nothing — it reaches for demo's typescript.
  assert.equal(
    existsSync(join(root, "package.json")),
    false,
    "the root is a directory of sources, not a package",
  );

  ["demo", "build", "tests"].forEach((island) => {
    assert.ok(
      existsSync(join(root, island, "package.json")),
      `${island}/ must own its own package.json`,
    );
  });

  const declared = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ].filter((field) =>
    JSON.parse(
      readFileSync(join(root, "tests", "package.json"), "utf8"),
    )[field],
  );

  assert.deepEqual(
    declared,
    [],
    "running the tests must not require an install of its own",
  );
});

test("npm test runs every test file", () => {
  // The script lists files explicitly (cmd.exe does not expand
  // globs), so a new file is silently skipped unless it gets
  // added there too.
  const testScript = JSON.parse(
    readFileSync(join(root, "tests", "package.json"), "utf8"),
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

test("every compiled file still has a source file", () => {
  // tsc overwrites what it compiles and never removes what is
  // no longer there. A deleted source therefore leaves a stale
  // .js in .build, and nothing imports it — so the suite stays
  // green while the build directory claims a module the source
  // tree does not have. Deleting the source is enough to make
  // this fail, which is the point: the leftovers become
  // visible instead of quietly accumulating.
  //
  // (The alternative — wiping .build first — is not done here on
  // purpose. It needs a recursive delete, and the surrounding
  // tooling routes those through a trash binary that times out
  // on a directory this size. Asserting the invariant is both
  // cheaper and harder to get wrong.)
  const buildDir = join(root, "tests", ".build");
  const sourceDir = join(root, "analytics");

  if (!existsSync(buildDir)) {
    return; // run `npm test`, which builds first
  }

  // `rootDir` is analytics/, so a compiled path maps straight
  // across: .build/core/queue/x.js was analytics/core/queue/x.ts.
  const orphans = walk(buildDir)
    .filter((file) => file.endsWith(".js"))
    .map((file) => join(sourceDir, file.slice(buildDir.length + 1).replace(/\.js$/, ".ts")))
    .filter((expected) => !existsSync(expected))
    .map((expected) => expected.slice(sourceDir.length + 1));

  assert.deepEqual(
    orphans,
    [],
    `stale compiled output with no source: ${orphans.join(", ")}. ` +
      "Delete the leftover .js from tests/.build.",
  );
});
