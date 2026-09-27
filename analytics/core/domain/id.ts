// core/domain/id.ts

/**
 * One source for every id the SDK emits: event ids and the
 * session id.
 *
 * `crypto.randomUUID` only exists in a secure context (https,
 * localhost, `file://`). An intranet page served over http, a
 * sandboxed iframe, or an older Safari has none — and tracking
 * is exactly the thing that loads on every page of such a site.
 * Reading it unguarded meant `init()` threw there, at module
 * setup, before the host app had done anything wrong.
 *
 * Weaker sources are therefore part of the contract, not an
 * emergency path. Each branch produces the same shape — a v4
 * UUID string — so nothing downstream can tell them apart.
 *
 * These ids are not secrets: they identify an event and a
 * session, not a user. `Math.random` collisions are handled by
 * the 122 bits of entropy that remain even in that branch.
 */

const HEX = "0123456789abcdef";

/** Version nibble (4) and variant bits (10xx) of a v4 UUID. */
function stamp(bytes: Uint8Array): Uint8Array {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytes;
}

function fromRandomUUID(): string | undefined {
  const source = globalThis.crypto;

  if (typeof source?.randomUUID !== "function") return undefined;

  try {
    return source.randomUUID();
  } catch {
    return undefined;
  }
}

function fromGetRandomValues(): string | undefined {
  const source = globalThis.crypto;

  if (typeof source?.getRandomValues !== "function") return undefined;

  try {
    const bytes = stamp(source.getRandomValues(new Uint8Array(16)));

    let hex = "";

    for (const byte of bytes) {
      hex += HEX[byte >> 4] + HEX[byte & 0x0f];
    }

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  } catch {
    return undefined;
  }
}

/**
 * Last resort, and still a valid v4 string: the version and
 * variant positions are fixed, everything else is random.
 */
function fromMathRandom(): string {
  let out = "";

  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += "-";
    } else if (i === 14) {
      out += "4";
    } else if (i === 19) {
      out += HEX[8 + Math.floor(Math.random() * 4)];
    } else {
      out += HEX[Math.floor(Math.random() * 16)];
    }
  }

  return out;
}

/**
 * A new event / session id.
 *
 * Never throws: a runtime without crypto falls through to
 * `Math.random`, which exists everywhere.
 */
export function createId(): string {
  return (
    fromRandomUUID() ?? fromGetRandomValues() ?? fromMathRandom()
  );
}
