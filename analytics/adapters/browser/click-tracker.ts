import { BaseTracker } from "../../core/api/tracker";
import type { EventRecorder } from "../../core/api/tracker";
import type { AnalyticsPlugin } from "../../core/api/plugin";
import { hasDom } from "../../core/dom";
import { readPageContext } from "../page-context";

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

        cssClass:
          element.className || null,

        ...readPageContext(),
      }
    );

  };

}

/**
 * The registry descriptor for this probe.
 *
 * `available()` says "only where there is a DOM" — the probe's
 * constructor reads `document`, so on a server it must never be
 * offered, let alone started.
 */
export const clickAdapter: AnalyticsPlugin<ClickTrackerOptions> = {
  name: "click",
  available: () => hasDom(),
  start(host, options) {
    const tracker = new ClickTracker(host, options);
    tracker.start();
    host.registerTracker(tracker);
  },
};