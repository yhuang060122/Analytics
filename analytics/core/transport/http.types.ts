import { AnalyticsContext } from "../domain";

export interface AnalyticsRequest {
  events: readonly AnalyticsContext[];
}

export interface AnalyticsResponse {
  accepted: number;
}
