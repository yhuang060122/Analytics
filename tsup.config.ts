// tsup.config.ts

import { defineConfig } from "tsup";

/**
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
 * composition-root entry on purpose: `init()` has to be
 * reachable from `import { init } from "analytics"`, which is
 * what package.json exports `.` to.
 */
const shared = {
  // There is no root tsconfig for tsup to inherit a target
  // from, so it would fall back to node16 — the wrong default
  // for a bundle that only ever runs in a browser.
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  outDir: "dist",

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
   * this package.json declares no `type` — the extension says
   * nothing about the module system, the export map does.
   */
  outExtension: () => ({ js: ".js" }),

  /**
   * No .d.ts: types still come from the TypeScript sources
   * this package ships (see the exports map; the demo builds
   * from source). Emitting declarations would need a root
   * typescript install, which deliberately lives under
   * demo/ instead.
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
    entry: { analytics: "analytics/index.ts" },
    format: ["esm"],
  },
  {
    ...shared,
    name: "iife",
    entry: { "analytics.iife": "analytics/iife.ts" },
    format: ["iife"],
  },
]);
