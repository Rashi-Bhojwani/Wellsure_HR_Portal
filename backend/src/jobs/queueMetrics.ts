import { Queue } from "bullmq";
import type { MetricDatum, MetricsService } from "../integrations/metrics";
import { createBullConnection } from "../lib/redis";
import { logger } from "../lib/logger";

// The numbers the alarms need and nothing else published: how many jobs are waiting, running, delayed and failed in each queue, and a heartbeat
// that proves the worker is alive (an alarm on the heartbeat going missing catches a worker that has stopped altogether, which no queue count can).

export type QueueCounts = { waiting: number; active: number; delayed: number; failed: number };
export type CountsFn = (queueName: string) => Promise<QueueCounts>;

export function queueMetricData(counts: Map<string, QueueCounts>): MetricDatum[] {
  const data: MetricDatum[] = [{ name: "WorkerHeartbeat", value: 1 }];
  for (const [queue, c] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dimensions = { Queue: queue };
    data.push(
      { name: "QueueWaiting", value: c.waiting, dimensions },
      { name: "QueueActive", value: c.active, dimensions },
      { name: "QueueDelayed", value: c.delayed, dimensions },
      { name: "QueueFailed", value: c.failed, dimensions },
    );
  }
  return data;
}

export function bullCountsFn(): { counts: CountsFn; close: () => Promise<void> } {
  const queues = new Map<string, Queue>();
  const queueFor = (name: string): Queue => {
    let q = queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: createBullConnection() });
      queues.set(name, q);
    }
    return q;
  };
  return {
    counts: async (name) => {
      const c = await queueFor(name).getJobCounts("waiting", "active", "delayed", "failed");
      return { waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0 };
    },
    close: async () => {
      await Promise.all([...queues.values()].map((q) => q.close()));
    },
  };
}

/** One collection and publish. Never throws: metrics must not take the worker down. */
export async function publishQueueMetrics(queueNames: string[], countsFn: CountsFn, metrics: MetricsService): Promise<void> {
  try {
    const counts = new Map<string, QueueCounts>();
    for (const name of queueNames) counts.set(name, await countsFn(name));
    await metrics.publish(queueMetricData(counts));
  } catch (err) {
    logger.warn({ err }, "could not publish queue metrics");
  }
}

export function startQueueMetrics(queueNames: string[], countsFn: CountsFn, metrics: MetricsService, intervalMs = 60_000): () => void {
  void publishQueueMetrics(queueNames, countsFn, metrics);
  const timer = setInterval(() => void publishQueueMetrics(queueNames, countsFn, metrics), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
