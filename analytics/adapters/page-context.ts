// adapters/page-context.ts

/**
 * Where an event happened, in the shape every probe puts on
 * its properties.
 *
 * It used to live inside `adapters/network/network-core.ts`,
 * which is the wrong home twice over: the reader has nothing
 * to do with HTTP, and the click probe had silently copied
 * the same three keys inline instead of calling it. One
 * reader, one key order, so `pagePath` / `pageUrl` /
 * `pageTitle` cannot drift between probes.
 */
export interface PageContext {
  pagePath: string;
  pageUrl: string;
  pageTitle: string;
}

/**
 * Reads the page context without assuming a browser.
 * Returns empty strings during SSR so a server render
 * never throws and never ships a fake URL.
 */
export function readPageContext(): PageContext {
  const scope = typeof globalThis !== "undefined" ? globalThis : undefined;

  const location = (scope as { location?: Location } | undefined)?.location;
  const doc = (scope as { document?: Document } | undefined)?.document;

  return {
    pagePath: location?.pathname ?? "",
    pageUrl: location?.href ?? "",
    pageTitle: doc?.title ?? "",
  };
}
