// adapters/registry.ts

import { warnOnce } from "../core/warn";
import type { Adapter } from "../core/api/plugin";

/**
 * A name -> adapter table.
 *
 * This is the discovery mechanism: an adapter is reachable from
 * `init()` because it was put here, not because some switch
 * table happened to name it. Built-ins register themselves, and
 * a third party registers before calling `init()` — or passes
 * the descriptor straight in via `init({ plugins: [...] })`.
 */
export class AdapterRegistry {

  private readonly items = new Map<string, Adapter>();

  /**
   * Add (or replace) an adapter.
   *
   * Same-name registration replaces the earlier one, for the
   * same reason the debug plugins do: a hot reload must not end
   * up with two copies that both start.
   */
  register(adapter: Adapter): void {

    const previous = this.items.get(adapter.name);

    if (previous && previous !== adapter) {
      warnOnce(
        "adapter-replaced",
        `adapter "${adapter.name}" was already registered and has been replaced`,
      );
    }

    this.items.set(adapter.name, adapter);

  }

  /** Remove an adapter by name. Returns false when absent. */
  unregister(name: string): boolean {
    return this.items.delete(name);
  }

  get(name: string): Adapter | undefined {
    return this.items.get(name);
  }

  /** Every adapter currently registered, in insertion order. */
  names(): string[] {
    return [...this.items.keys()];
  }

  clear(): void {
    this.items.clear();
  }

}

/**
 * The one registry the composition root reads.
 *
 * Process-wide on purpose: it is what lets a script-tag page
 * register an adapter through `window.analyticsAdapters` and
 * still have `init()` pick it up. `const`, not `let` — the
 * binding never changes, only its contents, so `reset()` has
 * nothing to forget here.
 */
export const defaultRegistry = new AdapterRegistry();

export function registerAdapter(adapter: Adapter): void {
  defaultRegistry.register(adapter);
}

export function unregisterAdapter(name: string): boolean {
  return defaultRegistry.unregister(name);
}

export function getAdapter(name: string): Adapter | undefined {
  return defaultRegistry.get(name);
}

export function listAdapters(): string[] {
  return defaultRegistry.names();
}
