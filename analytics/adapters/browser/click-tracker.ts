import { Analytics } from "../../core/api/analytics";

export interface ClickTrackerOptions {
  /**
   * HTML attribute used to identify trackable elements.
   * Default: data-analytics
   */
  attribute?: string;
}

export class ClickTracker {

  private readonly attribute: string;

  constructor(
    private readonly analytics: Analytics,
    options: ClickTrackerOptions = {}
  ) {
    this.attribute = options.attribute ?? "data-analytics";
  }

  start(): void {

    document.addEventListener(
      "click",
      this.handleClick,
      true
    );

  }

  stop(): void {

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

    this.analytics.track(
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