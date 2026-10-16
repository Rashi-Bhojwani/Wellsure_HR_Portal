import { env } from "../../config/env";
import { CloudWatchMetricsService } from "./CloudWatchMetricsService";
import { LocalMetricsService } from "./LocalMetricsService";
import type { MetricsService } from "./MetricsService";

export type { MetricDatum, MetricsService } from "./MetricsService";

function createMetricsService(): MetricsService {
  switch (env.METRICS_DRIVER) {
    case "local":
      return new LocalMetricsService();
    case "cloudwatch":
      return new CloudWatchMetricsService();
  }
}

export const metricsService: MetricsService = createMetricsService();
