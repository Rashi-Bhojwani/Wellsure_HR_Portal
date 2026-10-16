import { randomBytes } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { CloudWatchMetricsService } from "../../integrations/metrics/CloudWatchMetricsService";
import { LocalMetricsService } from "../../integrations/metrics/LocalMetricsService";
import type { MetricDatum, MetricsService } from "../../integrations/metrics";
import { createBullConnection } from "../../lib/redis";
import { bullCountsFn, publishQueueMetrics, queueMetricData, startQueueMetrics } from "../queueMetrics";

const recorder = () => {
  const sent: MetricDatum[][] = [];
  const service: MetricsService = { publish: async (d) => void sent.push(d) };
  return { sent, service };
};

describe("queue metrics", () => {
  it("publishes a heartbeat and waiting/active/delayed/failed for each queue, with the queue as a dimension", () => {
    const data = queueMetricData(new Map([["b-queue", { waiting: 3, active: 1, delayed: 0, failed: 2 }], ["a-queue", { waiting: 0, active: 0, delayed: 5, failed: 0 }]]));
    expect(data[0]).toEqual({ name: "WorkerHeartbeat", value: 1 });
    expect(data.filter((d) => d.dimensions?.Queue === "a-queue").map((d) => [d.name, d.value])).toEqual([["QueueWaiting", 0], ["QueueActive", 0], ["QueueDelayed", 5], ["QueueFailed", 0]]);
    expect(data.find((d) => d.name === "QueueFailed" && d.dimensions?.Queue === "b-queue")?.value).toBe(2);
    expect(data).toHaveLength(1 + 4 * 2);
  });

  it("reads the real counts out of BullMQ (waiting, failed)", async () => {
    const name = `metrics-test-${randomBytes(4).toString("hex")}`;
    const queue = new Queue(name, { connection: createBullConnection() });
    const counts = bullCountsFn();
    let worker: Worker | undefined;
    try {
      await queue.add("a", {});
      await queue.add("b", {});
      expect(await counts.counts(name)).toEqual({ waiting: 2, active: 0, delayed: 0, failed: 0 });
      await queue.add("later", {}, { delay: 60_000 });
      expect((await counts.counts(name)).delayed).toBe(1);
      const failing = new Worker(name, async (): Promise<void> => { throw new Error("boom"); }, { connection: createBullConnection() });
      failing.on("failed", () => undefined);
      worker = failing as unknown as Worker;
      await vi.waitFor(async () => expect((await counts.counts(name)).failed).toBe(2), { timeout: 10_000 });
    } finally {
      await worker?.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await counts.close();
    }
  });

  it("a failing collection or publish is logged and swallowed, never thrown into the worker", async () => {
    const failing: MetricsService = { publish: async () => { throw new Error("cloudwatch is down"); } };
    await expect(publishQueueMetrics(["q"], async () => ({ waiting: 1, active: 0, delayed: 0, failed: 0 }), failing)).resolves.toBeUndefined();
    const { service, sent } = recorder();
    await expect(publishQueueMetrics(["q"], async () => { throw new Error("redis is down"); }, service)).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });

  it("publishes on start and then on every interval, and stops when told", async () => {
    vi.useFakeTimers();
    try {
      const { service, sent } = recorder();
      const stop = startQueueMetrics(["q"], async () => ({ waiting: 0, active: 0, delayed: 0, failed: 0 }), service, 1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2500);
      expect(sent).toHaveLength(3);
      stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(sent).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("metrics drivers", () => {
  it("the local driver publishes nothing and cannot fail", async () => {
    await expect(new LocalMetricsService().publish([{ name: "x", value: 1 }])).resolves.toBeUndefined();
  });

  it("the CloudWatch driver sends the namespace, units and dimensions, in batches", async () => {
    const calls: Array<{ Namespace: string; MetricData: Array<{ MetricName: string; Unit: string; Dimensions: Array<{ Name: string; Value: string }> }> }> = [];
    const client = { send: vi.fn(async (cmd: { input: (typeof calls)[number] }) => { calls.push(cmd.input); return {}; }) };
    const cw = new CloudWatchMetricsService("Test/NS", client as never);
    await cw.publish(Array.from({ length: 250 }, (_, i) => ({ name: `m${i}`, value: i, dimensions: { Queue: "q" } })));
    expect(calls.map((c) => c.MetricData.length)).toEqual([100, 100, 50]);
    expect(calls[0]!.Namespace).toBe("Test/NS");
    expect(calls[0]!.MetricData[0]).toMatchObject({ MetricName: "m0", Unit: "Count", Dimensions: [{ Name: "Queue", Value: "q" }] });
  });
});
