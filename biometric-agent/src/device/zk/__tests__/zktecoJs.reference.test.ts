import Zkteco from "zkteco-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeZkDevice } from "../../../dev/zkFakeDevice";
import { Zk4370Driver } from "../zkDriver";

// The independent check on the fake device (D-F1). The fake and our driver
// were written from the same reading of the protocol, so a shared mistake
// would pass both. zkteco-js is a client people use with real ZKTeco/eSSL
// devices: if it reads our fake correctly — counts, every record, the clock,
// a small log and a chunked one — the fake behaves like those devices, and
// our driver passing against the fake means something.
const pad = (n: number) => String(n).padStart(2, "0");
// zkteco-js builds a JavaScript Date in this process's own timezone: read its
// wall-clock fields back the same way (this is the very behaviour D-F1
// rejected for the agent; harmless here, in one process).
const wallClock = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

describe("zkteco-js reads the fake device (the fake is checked against real-world client code)", () => {
  const big = Array.from({ length: 3_000 }, (_, i) => ({ deviceUserId: String((i % 125) + 2), localTime: `2026-10-${pad(1 + (i % 28))} ${pad(8 + (i % 12))}:${pad(i % 60)}:${pad((i * 13) % 60)}` }));
  let device: FakeZkDevice;
  let port: number;

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined); // zkteco-js logs every step
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    device = new FakeZkDevice({ serial: "AEXY225060969", records: big, clockOffsetSeconds: -95 });
    ({ tcpPort: port } = await device.start({ udpPort: null }));
  });

  afterAll(async () => {
    expect(device.violations).toEqual([]);
    await device.stop();
    vi.restoreAllMocks();
  });

  it("counts, every record (chunked, 120 KB) and the clock, exactly as the fake holds them and our driver reads them", async () => {
    const zk = new Zkteco("127.0.0.1", port, 5_000, 0);
    await zk.createSocket();
    const info = await zk.getInfo();
    expect(info).toMatchObject({ logCounts: 3_000, logCapacity: 100_000, userCounts: 125 });
    const { data } = await zk.getAttendances();
    expect(data).toHaveLength(3_000);
    const theirs = data.map((r) => [r.user_id, wallClock(new Date(r.record_time))]);
    expect(theirs).toEqual(big.map((r) => [r.deviceUserId, r.localTime]));
    const theirClock = wallClock(await zk.getTime());
    await zk.disconnect();

    const ours = new Zk4370Driver({ host: "127.0.0.1", port, transport: "tcp" });
    await ours.connect();
    const read = await ours.readAll(3_000);
    const ourClock = await ours.deviceTime();
    await ours.disconnect();
    expect(read.records.map((r) => [r.deviceUserId, r.localTime])).toEqual(theirs);
    // Both read the same (skewed) device clock, a moment apart.
    expect(Math.abs(Date.parse(ourClock.replace(" ", "T")) - Date.parse(theirClock.replace(" ", "T")))).toBeLessThan(3_000);
  });

  it("a small log answered in one reply", async () => {
    const small = new FakeZkDevice({ serial: "S2", records: big.slice(0, 7) });
    const { tcpPort } = await small.start({ udpPort: null });
    const zk = new Zkteco("127.0.0.1", tcpPort, 5_000, 0);
    await zk.createSocket();
    const { data } = await zk.getAttendances();
    await zk.disconnect();
    await small.stop();
    expect(data.map((r) => r.user_id)).toEqual(big.slice(0, 7).map((r) => r.deviceUserId));
    expect(small.violations).toEqual([]);
  });
});
