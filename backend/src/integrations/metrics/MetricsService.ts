export interface MetricDatum {
  name: string;
  value: number;
  unit?: "Count" | "Seconds" | "None";
  dimensions?: Record<string, string>;
}

// Where the application's own numbers go so alarms can read them: CloudWatch in staging/production, nowhere locally
// (METRICS_DRIVER). Publishing is best-effort by contract: a failure is logged by the caller and never stops the work.
export interface MetricsService {
  publish(data: MetricDatum[]): Promise<void>;
}
