const STORAGE_KEY = "analytics.session";

export class Session {
  readonly id: string;

  private constructor(id: string) {
    this.id = id;
  }

  /**
   * Get current browser session.
   * Create one if it doesn't exist.
   */
  static current(): Session {
    const existing = sessionStorage.getItem(STORAGE_KEY);

    if (existing) {
      return new Session(existing);
    }

    const id = crypto.randomUUID();

    sessionStorage.setItem(STORAGE_KEY, id);

    return new Session(id);
  }

  /**
   * Clear current session.
   */
  static reset(): void {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}