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
    .filter((file) =>
      /from\s+["'][^"']*core\/api\/(analytics|config)["']/.test(
        readFileSync(file, "utf8"),
      ),
    );

  assert.deepEqual(bad, [], "probes should import core/api/tracker only");
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
