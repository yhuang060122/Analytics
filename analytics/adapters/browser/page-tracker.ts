import { Analytics } from "../../core/api/analytics";

export class PageTracker {

  private currentPath = window.location.pathname;

  private enteredAt = performance.now();

  constructor(
    private readonly analytics: Analytics
  ) {}

  /**
   * Start browser page tracking.
   */
  start(): void {

    this.trackPage();

    this.enteredAt = performance.now();

    document.addEventListener(
      "visibilitychange",
      this.handleVisibility
    );

    window.addEventListener(
      "beforeunload",
      this.handleUnload
    );

  }

  stop(): void {

    document.removeEventListener(
      "visibilitychange",
      this.handleVisibility
    );

    window.removeEventListener(
      "beforeunload",
      this.handleUnload
    );

  }

  /**
   * Call this from Angular Router.
   */
  navigate(path: string): void {

    if (path === this.currentPath) {
      return;
    }

    this.trackDuration();

    this.currentPath = path;

    this.enteredAt = performance.now();

    this.trackPage(path);

  }

  private trackPage(
    path: string = this.currentPath
  ): void {

    this.analytics.page(
      path,
      {
        title: document.title,
      }
    );

  }

  private trackDuration(): void {

    const duration = Math.round(
      performance.now() - this.enteredAt
    );

    this.analytics.track(
      "Page Duration",
      {
        pagePath: this.currentPath,

        pageTitle: document.title,

        durationMs: duration,
      }
    );

  }

  private handleVisibility = (): void => {

    if (document.visibilityState === "hidden") {
      this.trackDuration();
    }

  };

  private handleUnload = (): void => {

    this.trackDuration();

  };

}