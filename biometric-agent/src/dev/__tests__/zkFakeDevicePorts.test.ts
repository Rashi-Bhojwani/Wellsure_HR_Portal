import dgram from "node:dgram";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeZkDevice } from "../zkFakeDevice";

// The fake device answers TCP and UDP on the same number, like a real one. The OS picks the UDP number (port 0) and TCP takes the same one; if either is taken
// or refused (Windows refuses UDP inside its reserved ranges with EACCES) the fake takes another pair rather than fail a whole test file.

afterEach(() => vi.restoreAllMocks());

const refuseFirstBind = (code: string, refusals = 1) => {
  const real = dgram.createSocket.bind(dgram);
  let calls = 0;
  vi.spyOn(dgram, "createSocket").mockImplementation(((...args: Parameters<typeof dgram.createSocket>) => {
    const socket = real(...args);
    calls += 1;
    if (calls <= refusals) {
      socket.bind = ((..._a: unknown[]) => {
        queueMicrotask(() => socket.emit("error", Object.assign(new Error(`bind ${code}`), { code })));
        return socket;
      }) as typeof socket.bind;
    }
    return socket;
  }) as typeof dgram.createSocket);
  return () => calls;
};

describe("the fake device finds a port pair that works", () => {
  it.each(["EADDRINUSE", "EACCES"])("takes a fresh port when the first UDP bind is refused with %s", async (code) => {
    const attempts = refuseFirstBind(code);
    const device = new FakeZkDevice({ serial: "TEST" });
    try {
      const ports = await device.start();
      expect(ports.udpPort).toBe(ports.tcpPort);
      expect(attempts()).toBeGreaterThanOrEqual(2);
    } finally {
      await device.stop();
    }
  });

  it("asks the OS for the UDP port (port 0) and answers TCP on the same number, both reachable", async () => {
    const real = dgram.createSocket.bind(dgram);
    const asked: unknown[] = [];
    vi.spyOn(dgram, "createSocket").mockImplementation(((...args: Parameters<typeof dgram.createSocket>) => {
      const socket = real(...args);
      const bind = socket.bind.bind(socket) as (...a: unknown[]) => dgram.Socket;
      socket.bind = ((...a: unknown[]) => { asked.push(a[0]); return bind(...a); }) as typeof socket.bind;
      return socket;
    }) as typeof dgram.createSocket);
    const device = new FakeZkDevice({ serial: "TEST" });
    try {
      const ports = await device.start();
      expect(asked).toEqual([0]);
      expect(ports.udpPort).toBe(ports.tcpPort);
      await new Promise<void>((resolve, reject) => { const c = net.connect(ports.tcpPort, "127.0.0.1", () => { c.destroy(); resolve(); }); c.once("error", reject); });
    } finally {
      await device.stop();
    }
  });

  it("a run of refused UDP binds, like a Windows reserved block, still ends with a working pair", async () => {
    const attempts = refuseFirstBind("EACCES", 40);
    const device = new FakeZkDevice({ serial: "TEST" });
    try {
      const ports = await device.start();
      expect(ports.udpPort).toBe(ports.tcpPort);
      expect(attempts()).toBe(41);
    } finally {
      await device.stop();
    }
  });

  it.each(["EADDRINUSE", "EACCES"])("takes a fresh pair when the TCP listen on the UDP's number is refused with %s", async (code) => {
    const real = net.createServer.bind(net);
    let calls = 0;
    vi.spyOn(net, "createServer").mockImplementation(((...args: Parameters<typeof net.createServer>) => {
      const server = real(...args);
      calls += 1;
      if (calls === 1) server.listen = ((..._a: unknown[]) => { queueMicrotask(() => server.emit("error", Object.assign(new Error(`listen ${code}`), { code }))); return server; }) as typeof server.listen;
      return server;
    }) as typeof net.createServer);
    const device = new FakeZkDevice({ serial: "TEST" });
    try {
      const ports = await device.start();
      expect(ports.udpPort).toBe(ports.tcpPort);
      expect(calls).toBe(2);
    } finally {
      await device.stop();
    }
  });

  it("does not hide other errors", async () => {
    refuseFirstBind("EPERM");
    const device = new FakeZkDevice({ serial: "TEST" });
    await expect(device.start()).rejects.toMatchObject({ code: "EPERM" });
    await device.stop();
  });
});
