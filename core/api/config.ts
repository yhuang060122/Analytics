export interface AutoTrackOptions {
  page?: boolean;
  click?: boolean;
  api?: boolean;
}

export interface DebugOptions {
  enabled?: boolean;
  inspector?: boolean;
  console?: boolean;
}

export interface AnalyticsConfig {
  endpoint: string;

  batchSize?: number;

  flushInterval?: number;

  apiKey?: string;

  headers?: Record<string, string>;

  autoTrack?: AutoTrackOptions;
  
  debug?: DebugOptions;
}