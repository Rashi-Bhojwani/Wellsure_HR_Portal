import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CMD,
  READ_ONLY_COMMANDS,
  TcpDeframer,
  WRITE_COMMANDS,
  buildPacket,
  decodeAttendance,
  decodeRecord16,
  decodeRecord40,
  decodeTime,
  encodeRecord40,
  encodeTime,
  makeCommKey,
  parseFreeSizes,
  parseOptionValue,
  tcpFrame,
  ProtocolError,
  UnsupportedFormatError,
} from "../protocol";

// The protocol layer against pyzk, the reference implementation: every vector
// in fixtures/pyzk-vectors.json was produced by running pyzk 0.9's own
// functions (fixtures/make_pyzk_vectors.py), not by this code.
interface Vectors {
  commkey: Array<{ key: number; session: number; ticks: number; bytes: string }>;
  headers: Array<{ command: number; data: string; session: number; reply: number; packet: string }>;
  time: Array<{ local: string; encoded: number; decoded: string }>;
  records40: Array<{ bytes: string; uid: number; userId: string; status: number; punch: number; local: string }>;
  records16: Array<{ bytes: string; userId: string; status: number; punch: number; workcode: number; local: string }>;
}
const vectors = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/pyzk-vectors.json"), "utf8")) as Vectors;

describe("ZK protocol, checked against pyzk", () => {
  it("the comm key scramble matches pyzk's make_commkey", () => {
    expect(vectors.commkey.length).toBeGreaterThan(5);
    for (const v of vectors.commkey) expect(makeCommKey(v.key, v.session, v.ticks).toString("hex"), `key ${v.key} session ${v.session}`).toBe(v.bytes);
  });

  it("every packet (header, checksum, reply-id step) matches pyzk's __create_header byte for byte", () => {
    for (const v of vectors.headers) {
      expect(buildPacket(v.command, Buffer.from(v.data, "hex"), v.session, v.reply).toString("hex"), `command ${v.command}`).toBe(v.packet);
    }
  });

  it("times encode and decode as pyzk does, straight to wall-clock text (no JavaScript Date, no PC timezone)", () => {
    for (const v of vectors.time) {
      expect(encodeTime(v.local)).toBe(v.encoded);
      expect(decodeTime(v.encoded)).toBe(v.decoded);
    }
  });

  it("40-byte and 16-byte records decode to pyzk's fields", () => {
    for (const v of vectors.records40) {
      expect(decodeRecord40(Buffer.from(v.bytes, "hex"))).toEqual({ deviceUserId: v.userId, localTime: v.local, status: String(v.punch), verifyMode: String(v.status), workcode: "0" });
    }
    for (const v of vectors.records16) {
      expect(decodeRecord16(Buffer.from(v.bytes, "hex"))).toEqual({ deviceUserId: v.userId, localTime: v.local, status: String(v.punch), verifyMode: String(v.status), workcode: String(v.workcode) });
    }
  });
});

describe("framing", () => {
  const a = tcpFrame(buildPacket(CMD.GET_TIME, Buffer.alloc(0), 7, 1));
  const b = tcpFrame(buildPacket(CMD.GET_VERSION, Buffer.from("abc"), 7, 2));

  it("reassembles packets however TCP splits or joins them", () => {
    const joined = Buffer.concat([a, b]);
    const d = new TcpDeframer();
    const out: Buffer[] = [];
    for (let i = 0; i < joined.length; i += 3) out.push(...d.push(joined.subarray(i, i + 3)));
    expect(out.map((p) => p.toString("hex"))).toEqual([a.subarray(8).toString("hex"), b.subarray(8).toString("hex")]);
    expect(new TcpDeframer().push(joined)).toHaveLength(2);
  });

  it("refuses bytes that lose the framing, rather than guessing", () => {
    expect(() => new TcpDeframer().push(Buffer.from("not a zk packet at all"))).toThrow(ProtocolError);
  });
});

describe("the attendance buffer", () => {
  const rec = (i: number) => encodeRecord40({ uid: i, deviceUserId: String(i), localTime: "2026-10-09 10:00:00", status: "1", verifyMode: "255" });
  const buffer = (n: number) => {
    const body = Buffer.concat(Array.from({ length: n }, (_, i) => rec(i + 1)));
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length, 0);
    return Buffer.concat([head, body]);
  };

  it("uses total ÷ the device's record count, and copes when a punch landed between counting and reading", () => {
    expect(decodeAttendance(buffer(3), 3).records).toHaveLength(3);
    const raced = decodeAttendance(buffer(4), 3); // counted 3, then someone punched
    expect(raced.format).toBe(40);
    expect(raced.records.map((r) => r.deviceUserId)).toEqual(["1", "2", "3", "4"]);
  });

  it("an empty log is no records, not an error", () => {
    expect(decodeAttendance(buffer(0), 0).records).toEqual([]);
  });

  it("a layout it can't read is UNSUPPORTED, never a guess", () => {
    const odd = Buffer.alloc(4 + 24);
    odd.writeUInt32LE(24, 0);
    expect(() => decodeAttendance(odd, 3)).toThrow(UnsupportedFormatError); // 8-byte records
  });

  it("a buffer shorter than it says is a protocol error", () => {
    const short = buffer(2).subarray(0, 50);
    expect(() => decodeAttendance(short, 2)).toThrow(ProtocolError);
  });
});

describe("replies", () => {
  it("reads the record count and capacity from the free-sizes reply (pyzk read_sizes)", () => {
    const b = Buffer.alloc(80);
    b.writeInt32LE(120, 16);
    b.writeInt32LE(5321, 32);
    b.writeInt32LE(100000, 64);
    expect(parseFreeSizes(b)).toEqual({ users: 120, records: 5321, recordCapacity: 100000 });
    expect(parseFreeSizes(Buffer.alloc(10))).toBeNull();
  });

  it("reads an option value", () => {
    expect(parseOptionValue(Buffer.from("~SerialNumber=AEXY225060969\0junk"))).toBe("AEXY225060969");
    expect(parseOptionValue(Buffer.from("~SerialNumber=\0"))).toBeNull();
  });
});

describe("P2-F rule 1: the agent never changes the device", () => {
  it("the allowlist holds only reads, and none of the commands that write, clear, set the clock, pause or restart", () => {
    for (const [name, code] of Object.entries(WRITE_COMMANDS)) expect(READ_ONLY_COMMANDS.has(code), name).toBe(false);
    expect([...READ_ONLY_COMMANDS].sort((x, y) => x - y)).toEqual([11, 50, 201, 1000, 1001, 1100, 1102, 1502, 1503, 1504]);
  });
});
