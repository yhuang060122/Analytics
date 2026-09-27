// core/warn.ts

/**
 * Say something once per page, then stay quiet.
 *
 * The SDK degrades rather than throws in a handful of places —
 * no `crypto.randomUUID`, no usable `sessionStorage`, a plugin
 * that blows up. Silence would make those invisible, and a line
 * per event would bury whatever the developer opened the
 * console for. One line each, keyed so two different problems
 * do not silence one another.
 */
const warned = new Set<string>();

export function warnOnce(key: string, message: string): void {
  if (typeof console === "undefined") return;
  if (warned.has(key)) return;

  warned.add(key);

  console.warn(`[analytics] ${message}`);
}
