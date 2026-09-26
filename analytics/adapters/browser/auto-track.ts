import { Analytics } from "../../core/api/analytics";
import { ClickTracker } from "./click-tracker";
import { PageTracker } from "./page-tracker";
import { FetchTracker } from "./fetch-tracker";

import { AutoTrackOptions } from "../../core/api/config";

export class AutoTrackManager {

  private readonly trackers: Array<{ stop(): void }> = [];

  constructor(
    private readonly analytics: Analytics,
    private readonly options: AutoTrackOptions = {}
  ) {}

  start(): void {

    if (this.options.page ?? true) {

      const tracker = new PageTracker(this.analytics);

      tracker.start();

      this.trackers.push(tracker);

    }

    if (this.options.click ?? true) {

      const tracker = new ClickTracker(this.analytics);

      tracker.start();

      this.trackers.push(tracker);

    }

    if (this.options.api ?? false) {

      const tracker = new FetchTracker(this.analytics);

      tracker.start();

      this.trackers.push(tracker);

    }

  }

  stop(): void {

    this.trackers.forEach(x => x.stop());

    this.trackers.length = 0;

  }

}