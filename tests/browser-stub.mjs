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

  /**
   * Just enough DOM for DebugInspector to build its panel:
   * createElement + body.appendChild + the handful of
   * properties the panel touches.
   */
  const element = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      id: "",
      style: { cssText: "" },
      appendChild(child) {
        el.children.push(child);
        return child;
      },
      insertBefore(child, ref) {
        const at = ref ? el.children.indexOf(ref) : -1;

        if (at < 0) el.children.push(child);
        else el.children.splice(at, 0, child);

        return child;
      },
      removeChild(child) {
        const i = el.children.indexOf(child);
        if (i >= 0) el.children.splice(i, 1);
        return child;
      },
      remove() {},
      setAttribute() {},
      addEventListener() {},
      removeEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    // Real DOM: assigning textContent drops every child, which
    // is exactly how the inspector clears its list. Without it
    // a full re-render would look like it stacked duplicates.
    let text = "";

    Object.defineProperty(el, "textContent", {
      get: () => text,
      set: (value) => {
        text = value;
        if (value === "") el.children.length = 0;
      },
      enumerable: true,
    });

    Object.defineProperty(el, "firstChild", {
      get: () => el.children[0] ?? null,
    });

    Object.defineProperty(el, "lastChild", {
      get: () => el.children[el.children.length - 1] ?? null,
    });

    return el;
  };

  globalThis.document = Object.assign(target(reg.doc), {
    visibilityState: "visible",
    title: "demo",
    referrer: "",
    createElement: element,
    body: element("body"),
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
