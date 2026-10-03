import { performance } from "node:perf_hooks";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";

/**
 * Minimal browser globals so the SDK can run under node.
 */
export function installBrowser(fetchImpl) {
  const reg = { win: {}, doc: {} };
  const storage = new Map();
  const batches = [];

  const target = (store) => ({
    addEventListener(type, handler) {
      (store[type] = store[type] || []).push(handler);
    },
    removeEventListener(type, handler) {
      const arr = store[type] || [];
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    },
  });

  globalThis.window = Object.assign(target(reg.win), {
    // unref so a pending flush timer never keeps the
    // test process alive (see destroy()/queue.stop())
    setTimeout: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return timer;
    },
    clearTimeout: (id) => clearTimeout(id),
    location: { pathname: "/p", href: "http://x/p", search: "" },
  });

  // In a browser window *is* the global object, so a reader
  // that goes through globalThis (readPageContext) has to see
  // the same location. Without this the page triple comes back
  // empty and a probe reading the page by hand would look fine.
  globalThis.location = globalThis.window.location;

  // Only what the SDK actually reads. There is no
  // createElement/appendChild here on purpose: a panel that
  // builds DOM would need a real DOM to be tested against, and
  // a fake one would pass while the browser failed. Probes get
  // their elements from the event, as hand-written objects.
  globalThis.document = Object.assign(target(reg.doc), {
    visibilityState: "visible",
    title: "demo",
    referrer: "",
  });

  globalThis.sessionStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  };

  // node 22 exposes navigator as a getter-only global
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "node" },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "performance", {
    value: performance,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: true,
  });

  globalThis.fetch = async (url, init) => {
    batches.push(JSON.parse(init.body));
    return fetchImpl ? fetchImpl(url, init) : { ok: true, status: 200 };
  };

  return {
    batches,
    reset: () => {
      for (const key of Object.keys(reg.win)) delete reg.win[key];
      for (const key of Object.keys(reg.doc)) delete reg.doc[key];
      batches.length = 0;
    },
    count: (scope, type) => (reg[scope][type] || []).length,
    fire: (scope, type, event = {}) =>
      (reg[scope][type] || []).slice().forEach((h) => h(event)),
    require: createRequire(import.meta.url),
  };
}

export const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read what the pipeline reported, without a plugin registry.
 *
 * `DebugController.observe` is the SDK's only test seam — the
 * stage and reason of a debug event exist nowhere else, since
 * the console is the single sink and its output is formatted
 * for a human. So the suite assigns a function to it.
 *
 * Returns the array it fills, plus the usual pair of shortcuts:
 * `stages` is `"<stage>:<event name>"` strings (what most
 * assertions want) and `reasons` is every failure reason seen,
 * in order.
 */
export function observeDebug(debug) {
  const events = [];
  const reasons = [];

  debug.observe = (event) => {
    events.push(event);

    if (event.reason) reasons.push(event.reason);
  };

  // Getters, not snapshots: assigning `events.stages` once would
  // freeze the list at that moment, and every assertion here
  // runs after more events have arrived.
  Object.defineProperties(events, {
    stages: {
      get: () =>
        events.map((event) => `${event.stage}:${event.context.event.name}`),
    },
    reasons: { get: () => [...reasons] },
  });

  return events;
}
