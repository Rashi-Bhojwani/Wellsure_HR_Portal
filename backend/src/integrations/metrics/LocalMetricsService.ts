import type { MetricDatum, MetricsService } from "./MetricsService";

/** Development: publishes nothing. */
export class LocalMetricsService implements MetricsService {
  async publish(_data: MetricDatum[]): Promise<void> {
    // intentionally empty
  }
}
