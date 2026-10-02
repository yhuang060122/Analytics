// core/domain/page-context.ts

/**
 * Where an event happened, in the shape every probe puts on
 * its properties.
 *
 * It used to live inside the network core, which is the
 * wrong home twice over: the reader has nothing to do with
 * HTTP, and the click probe had silently copied the same
 * three keys inline instead of calling it. One reader, one
 * key order, so `pagePath` / `pageUrl` / `pageTitle` cannot
 * drift between probes.
 *
 * There is deliberately no named type here. The only caller
 * spreads the result straight into an event's properties, so
 * an exported interface would be a name nothing needs — and
 * the keys are already pinned by the "page context is read
 * from one module" assertion in architecture.test.mjs, which
 * is what actually keeps them from drifting.
 */

/**
 * Reads the page context without assuming a browser.
 * Returns empty strings during SSR so a server render
 * never throws and never ships a fake URL.
 */
export function readPageContext(): {
  pagePath: string;
  pageUrl: string;
  pageTitle: string;
} {
  const scope = typeof globalThis !== "undefined" ? globalThis : undefined;

  const location = (scope as { location?: Location } | undefined)?.location;
  const doc = (scope as { document?: Document } | undefined)?.document;

  return {
    pagePath: location?.pathname ?? "",
    pageUrl: location?.href ?? "",
    pageTitle: doc?.title ?? "",
  };
}
