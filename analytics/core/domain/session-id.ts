import { warnOnce } from "../warn";
import { createId } from "./id";

const STORAGE_KEY = "analytics.session";

const STORAGE_WARNING =
  "sessionStorage is unavailable; falling back to a session " +
  "that lasts for this page only. Sessions cannot be continued " +
  "across reloads in this context.";

/**
 * The session storage refused to hold.
 *
 * Safari private mode throws on `sessionStorage` access rather
 * than returning nothing, and third-party iframes may be denied
 * it outright. Keeping the generated id here means the page
 * still gets *one* session id instead of a new one per event.
 */
let memorySession: Session | undefined;

/**
 * Whether talking to sessionStorage is still worth trying.
 *
 * Once it has thrown it will keep throwing, and every event on
 * the page asks — so the answer is remembered rather than
 * rediscovered thousands of times per visit.
 */
let usable = true;

function storage(): Storage | undefined {
  // No DOM, no storage (SSR). That is not a failure worth
  // warning about: there is no page to degrade.
  return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
}

function read(): string | null {
  const store = storage();

  if (!store || !usable) return null;

  try {
    return store.getItem(STORAGE_KEY);
  } catch {
    usable = false;
    warnOnce("session-storage", STORAGE_WARNING);

    return null;
  }
}

function write(id: string): void {
  const store = storage();

  if (!store || !usable) return;

  try {
    store.setItem(STORAGE_KEY, id);
  } catch {
    usable = false;
    warnOnce("session-storage", STORAGE_WARNING);
  }
}

function forget(): void {
  const store = storage();

  if (!store || !usable) return;

  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    usable = false;
    warnOnce("session-storage", STORAGE_WARNING);
  }
}

export class Session {
  readonly id: string;

  private constructor(id: string) {
    this.id = id;
  }

  /**
   * Get current browser session.
   * Create one if it doesn't exist.
   *
   * Never throws. When storage cannot be read or written the
   * session lives in memory for as long as the page does.
   */
  static current(): Session {
    const existing = read();

    if (existing) {
      const cached = memorySession;

      const session =
        cached && cached.id === existing ? cached : new Session(existing);

      memorySession = session;

      return session;
    }

    if (memorySession) return memorySession;

    const session = new Session(createId());

    write(session.id);

    memorySession = session;

    return session;
  }

  /**
   * Drop the current session, so the next `current()` mints a
   * new one.
   *
   * Exists for the tests, which need each case to start from a
   * clean session rather than inheriting the previous one's id.
   * It is deliberately off the public barrel: a host that wants
   * to end a session is describing something the SDK has no
   * opinion about — it should say so in its own words.
   */
  static reset(): void {
    memorySession = undefined;

    forget();
  }
}
