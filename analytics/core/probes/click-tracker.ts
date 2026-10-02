import { BaseTracker } from "../api/tracker";
import type { EventRecorder } from "../api/tracker";
import { hasDom } from "../dom";
import { readPageContext } from "../domain/page-context";

export interface ClickTrackerOptions {
  /**
   * HTML attribute used to identify trackable elements.
   * Default: data-analytics
   */
  attribute?: string;
}

/**
 * Marks an element whose text may be reported.
 *
 * `element.textContent` is the one property that routinely
 * carries personal data — a "Hi Sarah" greeting, a message
 * preview, a price with the customer's name next to it — so
 * it is opt-in per element rather than sent for every click.
 * The key stays present (as null) so the property schema
 * does not depend on which element was clicked.
 */
const TEXT_ATTRIBUTE = "data-analytics-text";

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

  /**
   * False without a DOM, so `start()` leaves the probe stopped
   * instead of throwing. Server-side rendering constructs the
   * whole probe chain; it just has nothing to listen to.
   */
  protected canStart(): boolean {
    return hasDom();
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

        text: element.hasAttribute(TEXT_ATTRIBUTE)
          ? element.textContent?.trim() ?? null
          : null,

        id:
          element.id || null,

        // `getAttribute`, not `.className`: on an SVG element
        // `className` is an `SVGAnimatedString` object, so the
        // one non-JSON value in the payload came from here.
        // The attribute is a plain string for every element, and
        // an absent class stays null either way.
        cssClass:
          element.getAttribute("class") || null,

        ...readPageContext(),
      }
    );

  };

}