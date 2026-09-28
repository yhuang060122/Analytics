import { BaseTracker } from "../../core/api/tracker";
import type { EventRecorder } from "../../core/api/tracker";

export class PageTracker extends BaseTracker {

  private readonly recorder: EventRecorder;

  private currentPath = window.location.pathname;

  private enteredAt = performance.now();

  constructor(recorder: EventRecorder) {
    super();

    this.recorder = recorder;
  }

  /**
   * Start browser page tracking.
   */
  protected onStart(): void {

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