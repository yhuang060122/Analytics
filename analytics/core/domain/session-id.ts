import { warnOnce } from "../warn";

/**
 * Where the host puts its correlation id.
 *
 * This used to be a private detail — the SDK minted an id and
 * stored it here without the host ever knowing. Now it is a
 * contract, so it is worth naming out loud: the host writes
 *
 *     sessionStorage.setItem("analytics.session", correlationId)
 *
 * and this is the only key the SDK reads.
 */
const STORAGE_KEY = "analytics.session";

const STORAGE_WARNING =
  "sessionStorage could not be read, so no session id is " +
  "available. Events will carry sessionId: null. If the host " +
  "writes a correlation id, it will be picked up on the next " +
  "event.";

/**
 * The host's correlation id, or null when there is not one.
 *
 * This used to mint a v4 UUID from a three-branch crypto
 * fallback chain and keep it for the length of the visit. That
 * went for the same reason `createId` went: the collector
 * assigns its own primary key, and nothing in this SDK ever
 * read a client-minted id — it was serialised into every batch
 * so the backend could correlate on an identifier the backend
 * was going to issue anyway.
 *
 * What is left is the half that was never the SDK's job. A
 * correlation id is the backend's to define and the host's to
 * supply; the SDK has no way to learn it, and inventing a second
 * one that means the same thing invites the collector to treat
 * two unrelated identifiers as one key. So the host writes it,
 * this reads it, and its absence is reported as `null` instead
 * of being papered over with a guess.
 *
 * Never throws. Storage that cannot be read is a missing id, not
 * a failed event — the payload stays the same shape either way,
 * which is what lets a collector tell "no id" from "no event".
 */
export function readSessionId(): string | null {
  // No DOM, no storage (SSR): there is no page to correlate, and
  // therefore nothing to degrade.
  if (typeof sessionStorage === "undefined") return null;

  let stored: string | null;

  try {
    stored = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Safari in private mode throws on `sessionStorage` access
    // rather than returning nothing, and a sandboxed third-party
    // iframe can be denied it outright.
    //
    // Deliberately not remembered as "storage is broken": this
    // used to set a flag so the throw happened once per page
    // rather than once per event. But the answer can change —
    // leaving private mode, a frame that stops being sandboxed —
    // and a cached "it does not work" would go on reporting a
    // stale verdict for the rest of the visit. `warnOnce` already
    // keeps this to one line per problem.
    warnOnce("session-storage", STORAGE_WARNING);

    return null;
  }

  // An empty string is what a host writes when the id it had
  // turned out to be blank. Reporting `""` would be worse than
  // reporting null: it is a value, so downstream grouping would
  // treat it as one and merge every such visit together.
  return stored ? stored : null;
}
