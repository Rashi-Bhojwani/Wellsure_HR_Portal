import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gracefulShutdown, isDraining, resetDrainingForTests } from "../../lib/lifecycle";

// Rolling deploys under ECS: SIGTERM arrives while the task is still in the load balancer. See lib/lifecycle.ts for what must happen.

afterEach(() => resetDrainingForTests());

describe("gracefulShutdown", () => {
  it("starts draining first, waits the drain period, runs the steps in order, then exits 0", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      const exit = vi.fn();
      const done = gracefulShutdown({
        signal: "SIGTERM",
        drainMs: 5000,
        exit,
        steps: [async () => void order.push("server"), async () => void order.push("db")],
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(isDraining()).toBe(true);
      expect(order).toEqual([]); // still draining: nothing closed yet
      await vi.advanceTimersByTimeAsync(5000);
      await done;
      expect(order).toEqual(["server", "db"]);
      expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exits 1 if a step fails, and exits anyway at the hard limit when a step hangs", async () => {
    const failed = vi.fn();
    await gracefulShutdown({ signal: "SIGTERM", drainMs: 0, exit: failed, steps: [async () => { throw new Error("nope"); }] });
    expect(failed).toHaveBeenCalledExactlyOnceWith(1);

    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      void gracefulShutdown({ signal: "SIGTERM", drainMs: 0, hardLimitMs: 3000, exit, steps: [() => new Promise<void>(() => undefined)] });
      await vi.advanceTimersByTimeAsync(3100);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

const backendDir = path.resolve(import.meta.dirname, "../../..");

async function get(port: number, p: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { headers: { Connection: "close" } });
  return { status: res.status, body: await res.text() };
}

// A real process, a real SIGTERM: the rolling-deploy sequence from the load balancer's side.
describe("the api process on SIGTERM", () => {
  let child: ChildProcess | undefined;
  afterEach(() => child?.kill("SIGKILL"));

  it("fails /ready at once, finishes a request already in progress, then exits 0", async () => {
    const port = await freePort();
    child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", "api"], {
      cwd: backendDir,
      env: { ...process.env, PORT: String(port), SHUTDOWN_DRAIN_SECONDS: "2", SHUTDOWN_HARD_LIMIT_SECONDS: "20" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<number | null>((resolve) => child!.on("exit", (code) => resolve(code)));
    let log = "";
    child.stdout!.on("data", (d: Buffer) => (log += d.toString()));
    child.stderr!.on("data", (d: Buffer) => (log += d.toString()));

    await vi.waitFor(async () => expect((await get(port, "/ready")).status).toBe(200), { timeout: 60_000, interval: 300 });

    // Start a request and leave it unfinished: headers and half the body.
    const body = JSON.stringify({ employeeCode: "NOBODY", password: "wrong-password-1" });
    const inFlight = new Promise<string>((resolve, reject) => {
      const sock = net.connect(port, "127.0.0.1", () => {
        sock.write(`POST /api/auth/login HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body.slice(0, 10)}`);
        setTimeout(() => sock.write(body.slice(10)), 4000); // after the drain period has ended and the server has stopped listening
      });
      let data = "";
      sock.on("data", (d) => (data += d.toString()));
      sock.on("end", () => resolve(data));
      sock.on("error", reject);
    });

    child.kill("SIGTERM");

    // Draining: still answering, but not ready, and asking clients to reconnect.
    await vi.waitFor(async () => expect((await get(port, "/ready")).status).toBe(503), { timeout: 3000, interval: 100 });
    expect((await get(port, "/ready")).body).toContain("draining");
    expect((await get(port, "/health")).status).toBe(200); // liveness is unaffected: ECS must not kill it for draining

    // After the drain period the server stops listening, but the request already in progress is completed, not cut off.
    const response = await inFlight;
    expect(response).toMatch(/^HTTP\/1\.1 (401|400|429)/);
    expect(await exited).toBe(0);
    expect(log).toContain("shutdown complete");
  }, 120_000);
});
