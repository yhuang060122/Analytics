import { AnalyticsContext } from "../domain";

export interface Destination {
  send(events: readonly AnalyticsContext[]): Promise<void>;
}
