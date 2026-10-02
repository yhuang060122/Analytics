import { BaseTracker } from "../api/tracker";
import type { EventRecorder } from "../api/tracker";
import { hasDom } from "../dom";

export class PageTracker extends BaseTracker {

  private readonly recorder: EventRecorder;

  /**
   * Read on `start()`, not here.
   *
   * A field initialiser runs during construction, so reading
   * `window.location` in one meant `new PageTracker(recorder)`
   * threw on a server — while `new Analytics(...)` right next to
   * it did not. That asymmetry is the worst shape a bug can
   * take: the facade is documented as safe to construct anywhere,
   * so the probe that sits next to it appears to be too.
   */
  private currentPath = "";

  private enteredAt = 0;

  constructor(recorder: EventRecorder) {
    super();

    this.recorder = recorder;
  }

  /**
   * Start browser page tracking.
   */
  protected canStart(): boolean {
    return hasDom();
  }

  protected onStart(): void {

    this.currentPath = window.location.pathname;

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

  protected onStop(): void {

    document.removeEventListener(
      "visibilitychange",
      this.handleVisibility
    );

    window.removeEventListener(
      "beforeunload",
      this.handleUnload
    );

  }

  private trackPage(
    path: string = this.currentPath
  ): void {

    this.recorder.page(
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

    this.recorder.track(
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