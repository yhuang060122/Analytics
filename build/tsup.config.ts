// tsup.config.ts

import { defineConfig } from "tsup";

/**
 * Lives in build/ so the repository root keeps its
 * dependencies to zero: tsup, typescript and rollup are
 * installed here, not next to the sources. Everything is
 * therefore relative to this file, one level up.
 *
 * Two builds from the same sources:
 *
 *   dist/analytics.js       ESM, the library entry (`index.ts`).
 *                           Side-effect free: importing it
 *                           starts nothing.
 *   dist/analytics.iife.js  `<script>` build (`iife.ts`). Side
 *                           effects only: it reads
 *                           window.analyticsOptions and
 *                           installs itself.
 *
 * The ESM bundle is the barrel rather than a slimmer
 * composition-root entry on purpose: the barrel is the
 * library's public surface, `init()` included. The IIFE
 * entry is the one place allowed to install by itself;
 * importing the ESM one must stay a decision the caller
 * makes.
 */
const shared = {
  // There is no root tsconfig for tsup to inherit a target
  // from, so it would fall back to node16 — the wrong default
  // for a bundle that only ever runs in a browser.
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  outDir: "../dist",

  /**
   * One file per build. Code splitting (tsup's default for
   * ESM) would turn the jQuery adapter's dynamic `import()`
   * into extra chunk files that have to ship next to
   * analytics.js, which defeats the point of a `<script>`
   * build. Without splitting esbuild inlines it instead.
   */
  splitting: false,

  /**
   * Both bundles are `.js`. Left to its defaults tsup would
   * emit analytics.mjs and analytics.iife.global.js, because
   * nothing here declares `type: module` — the extension says
   * nothing about the module system, the file's contents do.
   */
  outExtension: () => ({ js: ".js" }),

  /**
   * No .d.ts: consumers get their types from the TypeScript
   * sources they import, the way the demo does. Emitting
   * declarations would need the typescript in demo/ (or this
   * one) at the root, which is what keeping the build in
   * build/ avoids.
   */
  dts: false,

  minify: false,
} as const;

/**
 * No `clean` in either config, even though both write into
 * dist/: tsup builds them in parallel, so whichever ran first
 * would see its output removed by the other. Both entries have
 * fixed names, so a build overwrites its own file rather than
 * accumulating anything.
 */
export default defineConfig([
  {
    ...shared,
    name: "esm",
    entry: { analytics: "../analytics/index.ts" },
    format: ["esm"],
  },
  {
    ...shared,
    name: "iife",
    entry: { "analytics.iife": "../analytics/iife.ts" },
    format: ["iife"],
  },
]);
