import { AnalyticsContext } from "../core/domain";
import { EventFactory } from "../core/factory";
import { Destination, EventQueue } from "../core/queue";

export class ConsoleDestination implements Destination {
  async send(events: readonly AnalyticsContext[]): Promise<void> {
    console.log("SEND", events);
  }
}

const queue = new EventQueue(new ConsoleDestination(), {
  batchSize: 5,
  flushInterval: 2000,
});

queue.enqueue(EventFactory.track("Clicked"));

queue.enqueue(EventFactory.page("/dashboard"));
