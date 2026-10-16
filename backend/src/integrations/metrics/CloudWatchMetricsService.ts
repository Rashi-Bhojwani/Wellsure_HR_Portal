import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { env } from "../../config/env";
import type { MetricDatum, MetricsService } from "./MetricsService";

// PutMetricData accepts up to 1000 datums a call; stay far below it.
const BATCH = 100;

export class CloudWatchMetricsService implements MetricsService {
  constructor(
    private readonly namespace: string = env.METRICS_NAMESPACE,
    private readonly client: Pick<CloudWatchClient, "send"> = new CloudWatchClient({ region: env.AWS_REGION }),
  ) {}

  async publish(data: MetricDatum[]): Promise<void> {
    for (let i = 0; i < data.length; i += BATCH) {
      await this.client.send(
        new PutMetricDataCommand({
          Namespace: this.namespace,
          MetricData: data.slice(i, i + BATCH).map((d) => ({
            MetricName: d.name,
            Value: d.value,
            Unit: d.unit ?? "Count",
            Dimensions: Object.entries(d.dimensions ?? {}).map(([Name, Value]) => ({ Name, Value })),
          })),
        }),
      );
    }
  }
}
