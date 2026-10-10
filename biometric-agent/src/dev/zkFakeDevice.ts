import dgram from "node:dgram";
import net from "node:net";
import { instantToLocalTime } from "@shared/attendance/attlog";
import { buildReply, encodeRecord16, encodeRecord40, encodeTime, parsePacket, TcpDeframer, tcpFrame } from "../device/zk/protocol";

// A fake ZKTeco/eSSL device that speaks the real 4370 protocol over TCP and
// UDP (docs/plans/PHASE_2.md "P2-F build design"). Used by the agent's tests,
// and by `npm run fake-device` to run the whole route locally.
//
// Two things keep it honest, since it was written from the same reading of the
// protocol as the driver:
//   - zkteco-js (a client used with real devices) must read it correctly
//     (zkteco-js.reference.test.ts);
//   - it serves ONLY the read commands listed below, as literal numbers of its
//     own, not the driver's list. Anything else it receives is recorded in
//     `violations` and refused, and the tests fail if any arrive: the agent
//     must never send a command that changes the device (P2-F rule 1).
//
// It never pauses itself while being read, exactly like a real device the
// agent doesn't pause: a punch can land mid-read (see `punchDuringNextRead`).

const SERVED = {
  CONNECT: 1000,
  EXIT: 1001,
  AUTH: 1102,
  OPTIONS_RRQ: 11,
  GET_FREE_SIZES: 50,
  GET_TIME: 201,
  GET_VERSION: 1100,
  FREE_DATA: 1502,
  PREPARE_BUFFER: 1503,
  READ_BUFFER: 1504,
} as const;
const ATTLOG_RRQ = 13;
const R = { ACK_OK: 2000, ACK_ERROR: 2001, ACK_UNAUTH: 2005, PREPARE_DATA: 1500, DATA: 1501 } as const;

export interface FakeRecord {
  deviceUserId: string;
  localTime: string;
  /** Punch state (ATTLOG status). Our device: 1-style, no direction. */
  status?: number;
  /** Verify type: 1 fingerprint, 15 face, …; the ATTLOG sample shows 255. */
  verify?: number;
  workcode?: number;
}

export interface FakeDeviceOptions {
  serial: string;
  platform?: string;
  firmware?: string;
  /** The comm key the device demands; 0 / undefined = none. */
  commKey?: number;
  format?: 40 | 16;
  logCapacity?: number;
  /** When the log is full: drop the oldest (overwrite) or refuse new punches (stop). */
  whenFull?: "overwrite" | "stop";
  timezone?: string;
  /** The device clock's error, seconds (positive = ahead). */
  clockOffsetSeconds?: number;
  /** A buffered read at most this big is answered at once (CMD_DATA); bigger ones are chunked. */
  directDataMax?: number;
  /** How a chunk is answered over TCP: PREPARE_DATA + DATA + ACK_OK (what zkteco-js expects), or DATA alone. */
  chunkReply?: "prepare" | "data";
  /**
   * How replies go out over TCP. "separate" (default, like a real device):
   * each packet in its own write, a moment apart — zkteco-js, which handles one
   * packet per network read, depends on this. "joined": all of a request's
   * replies in one write. "fragmented": tiny writes. Our driver must cope with
   * all three.
   */
  tcpWrites?: "separate" | "joined" | "fragmented";
  users?: number;
  records?: FakeRecord[];
}

interface Session {
  id: number;
  authed: boolean;
  prepared: Buffer | null;
}

export class FakeZkDevice {
  records: FakeRecord[];
  readonly opts: Required<Omit<FakeDeviceOptions, "records">>;
  /** Every command code received, in order. */
  readonly commands: number[] = [];
  /** Commands received that aren't reads. Must stay empty. */
  readonly violations: number[] = [];
  /** Fault injection. */
  faults: { silent: boolean; dropDuringChunk: boolean; punchDuringNextRead: FakeRecord | null } = { silent: false, dropDuringChunk: false, punchDuringNextRead: null };
  private tcp: net.Server | null = null;
  private udp: dgram.Socket | null = null;
  private readonly sockets = new Set<net.Socket>();
  private readonly udpSessions = new Map<string, Session>();
  private nextSession = 4000;

  constructor(options: FakeDeviceOptions) {
    this.opts = {
      serial: options.serial,
      platform: options.platform ?? "ZMM220_TFT",
      firmware: options.firmware ?? "Ver 6.60 Apr 28 2015",
      commKey: options.commKey ?? 0,
      format: options.format ?? 40,
      logCapacity: options.logCapacity ?? 100_000,
      whenFull: options.whenFull ?? "overwrite",
      timezone: options.timezone ?? "Asia/Kolkata",
      clockOffsetSeconds: options.clockOffsetSeconds ?? 0,
      directDataMax: options.directDataMax ?? 1024,
      chunkReply: options.chunkReply ?? "prepare",
      tcpWrites: options.tcpWrites ?? "separate",
      users: options.users ?? 125,
    };
    this.records = [...(options.records ?? [])];
  }

  // ── The device's state ─────────────────────────────────────────────────

  /** The device clock, device-local. */
  now(): string {
    return instantToLocalTime(new Date(Date.now() + this.opts.clockOffsetSeconds * 1000), this.opts.timezone);
  }

  setClockOffset(seconds: number): void {
    this.opts.clockOffsetSeconds = seconds;
  }

  /** Someone punches (at the device clock's time unless given). */
  punch(deviceUserId: string, localTime: string = this.now(), extra: Partial<FakeRecord> = {}): boolean {
    if (this.records.length >= this.opts.logCapacity) {
      if (this.opts.whenFull === "stop") return false;
      this.records.shift();
    }
    this.records.push({ deviceUserId, localTime, ...extra });
    return true;
  }

  /** An admin clears the log from the device's own menu. */
  clear(): void {
    this.records = [];
  }

  private attendanceBuffer(): Buffer {
    const body = Buffer.concat(
      this.records.map((r, i) =>
        this.opts.format === 40
          ? encodeRecord40({ uid: i + 1, deviceUserId: r.deviceUserId, localTime: r.localTime, status: String(r.status ?? 1), verifyMode: String(r.verify ?? 255) })
          : encodeRecord16({ deviceUserId: r.deviceUserId, localTime: r.localTime, status: String(r.status ?? 1), verifyMode: String(r.verify ?? 255), workcode: String(r.workcode ?? 0) }),
      ),
    );
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length, 0);
    return Buffer.concat([head, body]);
  }

  private freeSizes(): Buffer {
    const b = Buffer.alloc(92);
    const set = (i: number, v: number) => b.writeInt32LE(v, i * 4);
    set(4, this.opts.users);
    set(6, this.opts.users * 2);
    set(8, this.records.length);
    set(14, 3000);
    set(15, 3000);
    set(16, this.opts.logCapacity);
    set(17, 3000 - this.opts.users * 2);
    set(18, 3000 - this.opts.users);
    set(19, this.opts.logCapacity - this.records.length);
    return b;
  }

  // ── Answering a request ────────────────────────────────────────────────

  /** The replies to one request packet, in order (empty: say nothing). */
  private handle(packet: Buffer, session: Session, transport: "tcp" | "udp"): { replies: Buffer[]; close?: boolean; drop?: boolean } {
    const req = parsePacket(packet);
    this.commands.push(req.command);
    const reply = (code: number, data: Buffer = Buffer.alloc(0)) => buildReply(code, data, session.id, req.replyId);
    const served = (Object.values(SERVED) as number[]).includes(req.command);
    if (!served) {
      this.violations.push(req.command);
      return { replies: [reply(R.ACK_ERROR)] };
    }
    if (this.faults.silent) return { replies: [] };
    if (req.command === SERVED.CONNECT) {
      session.authed = !this.opts.commKey;
      return { replies: [reply(session.authed ? R.ACK_OK : R.ACK_UNAUTH)] };
    }
    if (req.command === SERVED.AUTH) {
      session.authed = req.data.equals(expectedCommKey(this.opts.commKey, session.id));
      return { replies: [reply(session.authed ? R.ACK_OK : R.ACK_UNAUTH)] };
    }
    if (!session.authed) return { replies: [reply(R.ACK_UNAUTH)] };
    switch (req.command) {
      case SERVED.EXIT:
        return { replies: [reply(R.ACK_OK)], close: true };
      case SERVED.OPTIONS_RRQ: {
        const name = req.data.toString("latin1").split("\0")[0]!;
        const value = name === "~SerialNumber" ? this.opts.serial : name === "~Platform" ? this.opts.platform : name === "~DeviceName" ? "F22" : null;
        return { replies: [value === null ? reply(R.ACK_ERROR) : reply(R.ACK_OK, Buffer.from(`${name}=${value}\0`, "latin1"))] };
      }
      case SERVED.GET_VERSION:
        return { replies: [reply(R.ACK_OK, Buffer.from(`${this.opts.firmware}\0`, "latin1"))] };
      case SERVED.GET_FREE_SIZES:
        return { replies: [reply(R.ACK_OK, this.freeSizes())] };
      case SERVED.GET_TIME: {
        const t = Buffer.alloc(4);
        t.writeUInt32LE(encodeTime(this.now()), 0);
        return { replies: [reply(R.ACK_OK, t)] };
      }
      case SERVED.FREE_DATA:
        session.prepared = null;
        return { replies: [reply(R.ACK_OK)] };
      case SERVED.PREPARE_BUFFER: {
        const inner = req.data.length >= 3 ? req.data.readInt16LE(1) : -1;
        if (inner !== ATTLOG_RRQ) {
          this.violations.push(req.command);
          return { replies: [reply(R.ACK_ERROR)] };
        }
        if (this.faults.punchDuringNextRead) {
          const r = this.faults.punchDuringNextRead;
          this.faults.punchDuringNextRead = null;
          this.punch(r.deviceUserId, r.localTime, r);
        }
        const buf = this.attendanceBuffer();
        if (buf.length <= this.opts.directDataMax) return { replies: [reply(R.DATA, buf)] };
        session.prepared = buf;
        const ack = Buffer.alloc(9);
        ack.writeUInt32LE(buf.length, 1);
        return { replies: [reply(R.ACK_OK, ack)] };
      }
      case SERVED.READ_BUFFER: {
        if (!session.prepared || req.data.length < 8) return { replies: [reply(R.ACK_ERROR)] };
        const start = req.data.readInt32LE(0);
        const size = req.data.readInt32LE(4);
        const chunk = session.prepared.subarray(start, start + size);
        if (transport === "tcp" && this.opts.chunkReply === "data") return { replies: [reply(R.DATA, chunk)] };
        const prep = Buffer.alloc(8);
        prep.writeUInt32LE(chunk.length, 0);
        if (this.faults.dropDuringChunk) return { replies: [reply(R.PREPARE_DATA, prep)], drop: true };
        const pieces: Buffer[] = [];
        if (transport === "tcp") pieces.push(chunk);
        else for (let o = 0; o < chunk.length; o += 1024) pieces.push(chunk.subarray(o, o + 1024));
        return { replies: [reply(R.PREPARE_DATA, prep), ...pieces.map((p) => reply(R.DATA, p)), reply(R.ACK_OK)] };
      }
    }
    return { replies: [reply(R.ACK_ERROR)] };
  }

  // ── Serving ────────────────────────────────────────────────────────────

  async start(listen: { host?: string; tcpPort?: number; udpPort?: number | null } = {}): Promise<{ tcpPort: number; udpPort: number | null }> {
    const host = listen.host ?? "127.0.0.1";
    this.tcp = net.createServer((socket) => this.serveTcp(socket));
    await new Promise<void>((resolve, reject) => {
      this.tcp!.once("error", reject);
      this.tcp!.listen(listen.tcpPort ?? 0, host, () => resolve());
    });
    const tcpPort = (this.tcp.address() as net.AddressInfo).port;
    let udpPort: number | null = null;
    if (listen.udpPort !== null) {
      this.udp = dgram.createSocket("udp4");
      this.udp.on("message", (msg, rinfo) => this.serveUdp(msg, rinfo));
      await new Promise<void>((resolve) => this.udp!.bind(listen.udpPort ?? tcpPort, host, () => resolve()));
      udpPort = this.udp.address().port;
    }
    return { tcpPort, udpPort };
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    if (this.tcp) await new Promise<void>((resolve) => this.tcp!.close(() => resolve()));
    if (this.udp) await new Promise<void>((resolve) => this.udp!.close(() => resolve()));
    this.tcp = null;
    this.udp = null;
  }

  private serveTcp(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.setNoDelay(true);
    const session: Session = { id: this.nextSession++, authed: false, prepared: null };
    const deframer = new TcpDeframer();
    let queue: Promise<void> = Promise.resolve(); // one request answered at a time, in order
    const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 2));
    socket.on("data", (chunk) => {
      let packets: Buffer[];
      try {
        packets = deframer.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const p of packets) {
        queue = queue.then(async () => {
          if (socket.destroyed) return;
          const out = this.handle(p, session, "tcp");
          const frames = out.replies.map(tcpFrame);
          if (this.opts.tcpWrites === "joined") {
            if (frames.length) socket.write(Buffer.concat(frames));
          } else if (this.opts.tcpWrites === "fragmented") {
            const bytes = Buffer.concat(frames);
            for (let o = 0; o < bytes.length; o += 7) socket.write(bytes.subarray(o, o + 7));
          } else {
            for (const [i, f] of frames.entries()) {
              if (i > 0) await pause();
              if (socket.destroyed) return;
              socket.write(f);
            }
          }
          if (out.drop) socket.destroy();
          else if (out.close) socket.end();
        });
      }
    });
    socket.on("error", () => undefined);
    socket.on("close", () => this.sockets.delete(socket));
  }

  private serveUdp(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    const key = `${rinfo.address}:${rinfo.port}`;
    let session = this.udpSessions.get(key);
    if (!session || msg.readUInt16LE(0) === SERVED.CONNECT) {
      session = { id: this.nextSession++, authed: false, prepared: null };
      this.udpSessions.set(key, session);
    }
    const out = this.handle(msg, session, "udp");
    if (out.drop) return; // UDP: just stop answering
    for (const r of out.replies) this.udp?.send(r, rinfo.port, rinfo.address);
    if (out.close) this.udpSessions.delete(key);
  }
}

/**
 * The scrambled comm key a device expects (the vendor's MakeKey, as pyzk's
 * make_commkey). Written out here independently of the driver's makeCommKey,
 * so one mistake can't pass in both.
 */
function expectedCommKey(key: number, session: number): Buffer {
  const bits = key.toString(2).padStart(32, "0").split("").reverse().join("");
  const k = (parseInt(bits, 2) + session) % 2 ** 32;
  const le = [k & 0xff, (k >>> 8) & 0xff, (k >>> 16) & 0xff, (k >>> 24) & 0xff];
  const x = [le[0]! ^ 0x5a, le[1]! ^ 0x4b, le[2]! ^ 0x53, le[3]! ^ 0x4f];
  const t = 50;
  return Buffer.from([x[2]! ^ t, x[3]! ^ t, t, x[1]! ^ t]);
}
