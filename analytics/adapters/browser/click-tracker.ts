import { BaseTracker } from "../../core/api/tracker";
import type { EventRecorder } from "../../core/api/tracker";

export interface ClickTrackerOptions {
  /**
   * HTML attribute used to identify trackable elements.
   * Default: data-analytics
   */
  attribute?: string;
}

export class ClickTracker extends BaseTracker {

  private readonly recorder: EventRecorder;
  private readonly attribute: string;

  constructor(
    recorder: EventRecorder,
    options: ClickTrackerOptions = {}
  ) {
    super();

    this.recorder = recorder;
    this.attribute = options.attribute ?? "data-analytics";
  }

  protected onStart(): void {

    document.addEventListener(
      "click",
      this.handleClick,
      true
    );

  }

  protected onStop(): void {

    document.removeEventListener(
      "click",
      this.handleClick,
      true
    );

  }

  private handleClick = (
    event: MouseEvent
  ): void => {

    const selector = `[${this.attribute}]`;

    const element = (
      event.target as HTMLElement
    )?.closest(selector);

    if (!element) {
      return;
    }

    const name = element.getAttribute(this.attribute);

    if (!name) {
      return;
    }

    this.recorder.track(
      "Element Clicked",
      {
        element: name,

        tag: element.tagName,

        text:
          element.textContent?.trim() ?? null,

        id:
          element.id || null,

        cssClass:
          element.className || null,

        pagePath:
          window.location.pathname,

        pageUrl:
          window.location.href,

        pageTitle:
          document.title,
      }
    );

  };

}