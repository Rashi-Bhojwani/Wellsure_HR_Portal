import { afterEach, describe, expect, it } from "vitest";
import { FakeZkDevice, type FakeDeviceOptions } from "../../../dev/zkFakeDevice";
import { DeviceError } from "../../driver";
import { CMD, READ_ONLY_COMMANDS, WRITE_COMMANDS } from "../protocol";
import { Zk4370Driver, assertReadOnly } from "../zkDriver";

// Our read-only driver against the fake device, over TCP and UDP (D-F1).
// Every test also checks the fake received nothing but reads (P2-F rule 1).
const devices: FakeZkDevice[] = [];
const drivers: Zk4370Driver[] = [];

async function fake(opts: Partial<FakeDeviceOptions> = {}, listen: { udpPort?: number | null; tcpPort?: number } = {}) {
  const device = new FakeZkDevice({ serial: "AEXY225060969", ...opts });
  devices.push(device);
  const ports = await device.start(listen);
  return { device, ...ports };
}
function driver(port: number, opts: Partial<ConstructorParameters<typeof Zk4370Driver>[0]> = {}) {
  const d = new Zk4370Driver({ host: "127.0.0.1", port, timeoutMs: 2_000, connectTimeoutMs: 2_000, ...opts });
  drivers.push(d);
  return d;
}
const punches = (n: number, from = 1) => Array.from({ length: n }, (_, i) => ({ deviceUserId: String(((from + i) % 125) + 2), localTime: `2026-10-0${1 + (i % 9)} ${String(9 + (i % 10)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}` }));

afterEach(async () => {
  for (const d of drivers.splice(0)) await d.disconnect();
  for (const d of devices) expect(d.violations, "the agent sent a command that isn't a read").toEqual([]);
  for (const d of devices) for (const c of d.commands) expect(READ_ONLY_COMMANDS.has(c)).toBe(true);
  for (const d of devices.splice(0)) await d.stop();
});

describe("Zk4370Driver over TCP", () => {
  it("connects, reports the device's serial, platform, firmware, log count and capacity, and its clock", async () => {
    const { device, tcpPort } = await fake({ records: punches(5), logCapacity: 80_000, clockOffsetSeconds: 125 });
    const d = driver(tcpPort, { transport: "tcp" });
    await d.connect();
    expect(d.transportKind).toBe("tcp");
    expect(await d.info()).toEqual({ serial: "AEXY225060969", platform: "ZMM220_TFT", firmware: "Ver 6.60 Apr 28 2015", logCount: 5, logCapacity: 80_000, userCount: 125 });
    // The device's own (skewed) clock, as wall-clock text. Bracketed, because the second can tick between the calls.
    const before = device.now();
    const read = await d.deviceTime();
    const after = device.now();
    expect(read >= before && read <= after).toBe(true);
  });

  it("reads a small log answered at once, and a large one in chunks, identically", async () => {
    const small = punches(10);
    const { tcpPort: p1 } = await fake({ records: small });
    const d1 = driver(p1, { transport: "tcp" });
    await d1.connect();
    const r1 = await d1.readAll(10);
    expect(r1.records.map((r) => [r.deviceUserId, r.localTime])).toEqual(small.map((r) => [r.deviceUserId, r.localTime]));
    expect(r1.records[0]).toMatchObject({ status: "1", verifyMode: "255", workcode: "0" });

    const big = punches(4_000); // 160 KB: three chunks of 0xFFC0
    const { device, tcpPort: p2 } = await fake({ records: big });
    const d2 = driver(p2, { transport: "tcp" });
    await d2.connect();
    const r2 = await d2.readAll(4_000);
    expect(r2.records).toHaveLength(4_000);
    expect(r2.records[3_999]!.localTime).toBe(big[3_999]!.localTime);
    expect(device.commands.filter((c) => c === CMD.READ_BUFFER)).toHaveLength(3);
    expect(device.commands.at(-1)).toBe(CMD.FREE_DATA); // the device's transfer buffer is always released
  });

  it("copes with replies joined into one TCP write, split into tiny writes, and chunks answered as one DATA packet", async () => {
    const { tcpPort: p0 } = await fake({ records: punches(2_000), tcpWrites: "joined" });
    const d0 = driver(p0, { transport: "tcp" });
    await d0.connect();
    expect((await d0.readAll(2_000)).records).toHaveLength(2_000);
    const { tcpPort: p1 } = await fake({ records: punches(2_000), tcpWrites: "fragmented" });
    const d1 = driver(p1, { transport: "tcp" });
    await d1.connect();
    expect((await d1.readAll(2_000)).records).toHaveLength(2_000);
    const { tcpPort: p2 } = await fake({ records: punches(2_000), chunkReply: "data" });
    const d2 = driver(p2, { transport: "tcp" });
    await d2.connect();
    expect((await d2.readAll(2_000)).records).toHaveLength(2_000);
  });

  it("reads 16-byte records (older firmware) with their workcode", async () => {
    const { tcpPort } = await fake({ format: 16, records: [{ deviceUserId: "113", localTime: "2021-09-01 19:02:25", workcode: 7 }] });
    const d = driver(tcpPort, { transport: "tcp" });
    await d.connect();
    const r = await d.readAll(1);
    expect(r.format).toBe(16);
    expect(r.records).toEqual([{ deviceUserId: "113", localTime: "2021-09-01 19:02:25", status: "1", verifyMode: "255", workcode: "7" }]);
  });

  it("a punch that lands while the log is being read is simply part of this read or the next — the device is never paused", async () => {
    const { device, tcpPort } = await fake({ records: punches(3) });
    const d = driver(tcpPort, { transport: "tcp" });
    await d.connect();
    const counted = (await d.info()).logCount;
    device.faults.punchDuringNextRead = { deviceUserId: "44", localTime: "2026-10-09 10:15:00" };
    const r = await d.readAll(counted);
    expect(r.records.map((x) => x.deviceUserId).at(-1)).toBe("44");
    expect(device.commands).not.toContain(WRITE_COMMANDS.DISABLEDEVICE);
    expect(device.commands).not.toContain(WRITE_COMMANDS.ENABLEDEVICE);
  });
});

describe("Zk4370Driver over UDP, and choosing the transport", () => {
  it("reads the same log over UDP: 16 KiB chunks arriving as 1 KiB datagrams", async () => {
    const big = punches(1_000); // 40 KB: three UDP chunks
    const { device, udpPort } = await fake({ records: big });
    const d = driver(udpPort!, { transport: "udp" });
    await d.connect();
    expect(d.transportKind).toBe("udp");
    expect((await d.info()).serial).toBe("AEXY225060969");
    const r = await d.readAll(1_000);
    expect(r.records.map((x) => x.localTime)).toEqual(big.map((x) => x.localTime));
    expect(device.commands.filter((c) => c === CMD.READ_BUFFER)).toHaveLength(3);
  });

  it("'auto' tries TCP first and falls back to UDP when TCP can't connect", async () => {
    const { tcpPort } = await fake({ records: punches(2) }, { udpPort: null });
    const { udpPort } = await fake({ records: punches(2) }, { udpPort: 0 }); // a UDP port with no TCP listener behind it
    expect(udpPort).not.toBe(tcpPort);
    const viaTcp = driver(tcpPort);
    await viaTcp.connect();
    expect(viaTcp.transportKind).toBe("tcp");
    const viaUdp = driver(udpPort!, { connectTimeoutMs: 1_000 });
    await viaUdp.connect();
    expect(viaUdp.transportKind).toBe("udp");
    expect((await viaUdp.readAll(2)).records).toHaveLength(2);
  });
});

describe("the comm key", () => {
  it("authenticates with the right key; a wrong or missing key is AUTH_FAILED, not 'unreachable', and isn't retried over UDP", async () => {
    const { tcpPort } = await fake({ commKey: 123456, records: punches(2) });
    const ok = driver(tcpPort, { commKey: 123456 });
    await ok.connect();
    expect((await ok.readAll(2)).records).toHaveLength(2);
    for (const commKey of [654321, null]) {
      const bad = driver(tcpPort, { commKey });
      const err = await bad.connect().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DeviceError);
      expect((err as DeviceError).kind).toBe("AUTH_FAILED");
    }
  });
});

describe("failures end the session cleanly", () => {
  it("a device that stops answering is UNREACHABLE within the timeout", async () => {
    const { device, tcpPort } = await fake({ records: punches(2) });
    const d = driver(tcpPort, { transport: "tcp", timeoutMs: 300 });
    await d.connect();
    device.faults.silent = true;
    const err = await d.readAll(2).catch((e: unknown) => e);
    expect((err as DeviceError).kind).toBe("UNREACHABLE");
  });

  it("a connection dropped in the middle of a chunk fails the read; the next session reads everything", async () => {
    const { device, tcpPort } = await fake({ records: punches(3_000) });
    const d = driver(tcpPort, { transport: "tcp" });
    await d.connect();
    device.faults.dropDuringChunk = true;
    expect(((await d.readAll(3_000).catch((e: unknown) => e)) as DeviceError).kind).toBe("UNREACHABLE");
    await d.disconnect();
    device.faults.dropDuringChunk = false;
    await d.connect();
    expect((await d.readAll(3_000)).records).toHaveLength(3_000);
  });

  it("nothing listening is UNREACHABLE", async () => {
    const d = driver(1, { transport: "tcp", connectTimeoutMs: 1_000 });
    expect(((await d.connect().catch((e: unknown) => e)) as DeviceError).kind).toBe("UNREACHABLE");
  });
});

describe("P2-F rule 1, at the send path", () => {
  it("refuses every write command before a byte leaves, and a buffered read of anything but the attendance log", async () => {
    const { device, tcpPort } = await fake({ records: punches(1) });
    const d = driver(tcpPort, { transport: "tcp" });
    await d.connect();
    const before = device.commands.length;
    for (const [name, code] of Object.entries(WRITE_COMMANDS)) {
      const err = await d.command(code).catch((e: unknown) => e);
      expect((err as DeviceError).kind, name).toBe("NOT_ALLOWED");
    }
    const users = Buffer.alloc(11);
    users.writeInt8(1, 0);
    users.writeInt16LE(9, 1); // CMD_USERTEMP_RRQ: reading users isn't something the agent needs
    expect(() => assertReadOnly(CMD.PREPARE_BUFFER, users)).toThrow(/attendance log/);
    expect(device.commands.length).toBe(before); // nothing reached the device
  });
});
