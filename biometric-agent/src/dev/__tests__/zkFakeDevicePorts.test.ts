import dgram from "node:dgram";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeZkDevice } from "../zkFakeDevice";

// The fake device answers TCP and UDP on the same number, like a real one. The OS picks the TCP number; if the UDP socket cannot have the same number (in use, or
// refused, which is what Windows does inside its reserved ranges) the fake must take another number rather than fail a whole test file.

afterEach(() => vi.restoreAllMocks());

const refuseFirstBind = (code: string) => {
  const real = dgram.createSocket.bind(dgram);
  let calls = 0;
  vi.spyOn(dgram, "createSocket").mockImplementation(((...args: Parameters<typeof dgram.createSocket>) => {
    const socket = real(...args);
    calls += 1;
    if (calls === 1) {
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

  it("does not hide other errors", async () => {
    refuseFirstBind("EPERM");
    const device = new FakeZkDevice({ serial: "TEST" });
    await expect(device.start()).rejects.toMatchObject({ code: "EPERM" });
    await device.stop();
  });
});
