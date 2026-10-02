// tsup.config.ts

import { defineConfig } from "tsup";

/**
 * Lives in build/ so the repository root keeps its
 * dependencies to zero: tsup, typescript and rollup are
 * installed here, not next to the sources. Everything is
 * therefore relative to this file, one level up.
 *
 * One build: dist/analytics.js, the ESM library entry
 * (`index.ts`). Side-effect free — importing it starts
 * nothing, and wiring the probes stays the caller's decision.
 *
 * There used to be a second `<script>` bundle that read
 * `window.analyticsOptions` and installed itself. It is gone,
 * and with it the whole class of problems that came with it:
 * a second entry to keep out of the barrel, a global name to
 * document, a self-installing path nobody could turn off, and
 * a second artifact to test. A bundler is the supported way
 * to consume the SDK; `analytics.page()` is the supported way
 * for a host with its own routing to report navigation.
 */
export default defineConfig({
  // There is no root tsconfig for tsup to inherit a target
  // from, so it would fall back to node16 — the wrong default
  // for a bundle that only ever runs in a browser.
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  outDir: "../dist",
  entry: { analytics: "../analytics/index.ts" },
  format: ["esm"],

  /**
   * One file, no chunks. Code splitting (tsup's default for
   * ESM) would emit extra chunk files that have to ship next
   * to analytics.js; without it esbuild inlines everything.
   */
  splitting: false,

  /**
   * The bundle is `.js`. Left to its defaults tsup would emit
   * analytics.mjs, because nothing here declares
   * `type: module` — the extension says nothing about the
   * module system, the file's contents do.
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

  /**
   * No `clean`, even though the build writes into dist/:
   * consumers may well have the previous bundle checked out,
   * and a build that deletes files it did not create is a
   * build that can lose work. The entry name is fixed, so a
   * build overwrites its own file rather than accumulating.
   */
  minify: false,
});
