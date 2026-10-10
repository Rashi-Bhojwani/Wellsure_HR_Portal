import { DeviceError, type DeviceDriver, type DeviceInfo } from "../driver";
import {
  CMD,
  MAX_CHUNK_TCP,
  MAX_CHUNK_UDP,
  READ_ONLY_BUFFERED,
  READ_ONLY_COMMANDS,
  USHRT_MAX,
  buildPacket,
  cString,
  decodeAttendance,
  decodeTime,
  makeCommKey,
  parseFreeSizes,
  parseOptionValue,
  parsePacket,
  ProtocolError,
  UnsupportedFormatError,
  type AttRecord,
  type Packet,
  type RecordFormat,
} from "./protocol";
import { TcpTransport, UdpTransport, type Transport } from "./transport";

// Our read-only driver for the ZKTeco / eSSL protocol on port 4370 (D-F1,
// docs/plans/PHASE_2.md "P2-F build design").
//
// Rule 1 of P2-F, structurally: every packet leaves through `command()`, which
// refuses anything outside READ_ONLY_COMMANDS, and a buffered read may fetch
// only the attendance log. There is no code here that writes, clears, sets the
// clock, pauses the device or touches users, and the device is never paused
// while it is read, so nobody is ever kept from punching.
//
// Any timeout or protocol surprise ends the session: the next cycle starts
// clean, so a late reply can never be taken for the answer to a later command.

export interface ZkDriverOptions {
  host: string;
  port?: number;
  /** "auto": TCP, then UDP if TCP can't connect. */
  transport?: "auto" | "tcp" | "udp";
  /** The device's comm key (connection password); 0 / null when it has none. */
  commKey?: number | null;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  /** Tests substitute transports; production never does. */
  transportFactory?: (kind: "tcp" | "udp", host: string, port: number) => Transport;
}

const defaultFactory = (kind: "tcp" | "udp", host: string, port: number): Transport => (kind === "tcp" ? new TcpTransport(host, port) : new UdpTransport(host, port));

export class Zk4370Driver implements DeviceDriver {
  private transport: Transport | null = null;
  private session = 0;
  private replyId = USHRT_MAX - 1;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly factory: NonNullable<ZkDriverOptions["transportFactory"]>;
  /** Packets that arrived unasked and were dropped (diagnostics). */
  droppedPackets = 0;

  constructor(private readonly opts: ZkDriverOptions) {
    this.port = opts.port ?? 4370;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 5_000;
    this.factory = opts.transportFactory ?? defaultFactory;
  }

  /** Which transport the open session uses (diagnose prints it). */
  get transportKind(): "tcp" | "udp" | null {
    return this.transport?.kind ?? null;
  }

  async connect(): Promise<void> {
    const mode = this.opts.transport ?? "auto";
    const kinds: Array<"tcp" | "udp"> = mode === "auto" ? ["tcp", "udp"] : [mode];
    let lastError: unknown = null;
    for (const kind of kinds) {
      try {
        await this.open(kind);
        return;
      } catch (err) {
        await this.close();
        // A wrong comm key is an answer, not a connection problem: don't retry over UDP.
        if (err instanceof DeviceError && err.kind === "AUTH_FAILED") throw err;
        lastError = err;
      }
    }
    throw lastError instanceof DeviceError ? lastError : new DeviceError("UNREACHABLE", String(lastError));
  }

  private async open(kind: "tcp" | "udp"): Promise<void> {
    this.transport = this.factory(kind, this.opts.host, this.port);
    await this.transport.open(this.connectTimeoutMs);
    this.session = 0;
    this.replyId = USHRT_MAX - 1;
    const reply = await this.command(CMD.CONNECT);
    this.session = reply.session;
    if (reply.command === CMD.ACK_UNAUTH) {
      const auth = await this.command(CMD.AUTH, makeCommKey(this.opts.commKey ?? 0, this.session));
      if (auth.command !== CMD.ACK_OK) {
        throw new DeviceError("AUTH_FAILED", "The device refused the comm key. Check the comm key stored for this device against the device's Comm settings.");
      }
    } else if (reply.command !== CMD.ACK_OK) {
      throw new DeviceError("PROTOCOL", `The device answered the connection with code ${reply.command}.`);
    }
  }

  async info(): Promise<DeviceInfo> {
    const option = async (name: string) => {
      const r = await this.command(CMD.OPTIONS_RRQ, Buffer.from(`~${name}\0`, "latin1"));
      return r.command === CMD.ACK_OK ? parseOptionValue(r.data) : null;
    };
    const serial = await option("SerialNumber");
    const platform = await option("Platform");
    const version = await this.command(CMD.GET_VERSION);
    const sizes = await this.command(CMD.GET_FREE_SIZES);
    const parsed = sizes.command === CMD.ACK_OK ? parseFreeSizes(sizes.data) : null;
    return {
      serial,
      platform,
      firmware: version.command === CMD.ACK_OK ? cString(version.data) : null,
      logCount: parsed?.records ?? null,
      logCapacity: parsed?.recordCapacity ?? null,
      userCount: parsed?.users ?? null,
    };
  }

  async readAll(recordCountHint: number | null): Promise<{ format: RecordFormat; records: AttRecord[] }> {
    const data = await this.readBuffered(CMD.ATTLOG_RRQ);
    try {
      return decodeAttendance(data, recordCountHint);
    } catch (err) {
      if (err instanceof UnsupportedFormatError) throw new DeviceError("UNSUPPORTED_FORMAT", err.message);
      if (err instanceof ProtocolError) throw new DeviceError("PROTOCOL", err.message);
      throw err;
    }
  }

  async deviceTime(): Promise<string> {
    const r = await this.command(CMD.GET_TIME);
    if (r.command !== CMD.ACK_OK || r.data.length < 4) throw new DeviceError("PROTOCOL", `The device didn't give its time (code ${r.command}).`);
    return decodeTime(r.data.readUInt32LE(0));
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.command(CMD.EXIT, Buffer.alloc(0), 2_000);
      } catch {
        // Closing anyway; the device drops idle sessions on its own.
      }
    }
    await this.close();
  }

  private async close(): Promise<void> {
    const t = this.transport;
    this.transport = null;
    if (t) await t.close();
  }

  // ── The one way out ────────────────────────────────────────────────────

  /** Sends one command and returns the reply. Refuses anything that isn't read-only (P2-F rule 1). */
  async command(command: number, data: Buffer = Buffer.alloc(0), timeoutMs = this.timeoutMs): Promise<Packet> {
    assertReadOnly(command, data);
    const t = this.transport;
    if (!t) throw new DeviceError("UNREACHABLE", "Not connected.");
    this.droppedPackets += t.drain();
    await t.send(buildPacket(command, data, this.session, this.replyId));
    const reply = await this.receive(timeoutMs);
    this.replyId = reply.replyId; // the sequence continues from the device's reply, as pyzk does
    return reply;
  }

  private async receive(timeoutMs = this.timeoutMs): Promise<Packet> {
    const t = this.transport;
    if (!t) throw new DeviceError("UNREACHABLE", "Not connected.");
    try {
      return parsePacket(await t.receive(timeoutMs));
    } catch (err) {
      if (err instanceof ProtocolError) throw new DeviceError("PROTOCOL", err.message);
      throw err;
    }
  }

  /**
   * The buffered read (pyzk read_with_buffer): ask the device to prepare the
   * data; a small answer comes back at once, a large one is fetched in chunks;
   * then the device's transfer buffer is freed. Nothing on the device changes.
   */
  private async readBuffered(inner: number): Promise<Buffer> {
    const req = Buffer.alloc(11);
    req.writeInt8(1, 0);
    req.writeInt16LE(inner, 1);
    const first = await this.command(CMD.PREPARE_BUFFER, req);
    let data: Buffer;
    if (first.command === CMD.DATA) {
      data = first.data;
    } else if (first.command === CMD.ACK_OK && first.data.length >= 5) {
      const size = first.data.readUInt32LE(1);
      const maxChunk = this.transport?.kind === "udp" ? MAX_CHUNK_UDP : MAX_CHUNK_TCP;
      const parts: Buffer[] = [];
      for (let start = 0; start < size; start += maxChunk) parts.push(await this.readChunk(start, Math.min(maxChunk, size - start)));
      data = Buffer.concat(parts);
    } else {
      throw new DeviceError("PROTOCOL", `The device didn't prepare the attendance log (code ${first.command}).`);
    }
    const freed = await this.command(CMD.FREE_DATA);
    if (freed.command !== CMD.ACK_OK) throw new DeviceError("PROTOCOL", `The device didn't release its transfer buffer (code ${freed.command}).`);
    return data;
  }

  private async readChunk(start: number, size: number): Promise<Buffer> {
    const req = Buffer.alloc(8);
    req.writeInt32LE(start, 0);
    req.writeInt32LE(size, 4);
    const reply = await this.command(CMD.READ_BUFFER, req);
    let chunk: Buffer;
    if (reply.command === CMD.DATA) {
      chunk = reply.data;
    } else if (reply.command === CMD.PREPARE_DATA) {
      // Then DATA packet(s) until ACK_OK (one large packet over TCP; 1 KiB datagrams over UDP).
      const parts: Buffer[] = [];
      for (;;) {
        const p = await this.receive();
        if (p.command === CMD.DATA) parts.push(p.data);
        else if (p.command === CMD.ACK_OK) break;
        else throw new DeviceError("PROTOCOL", `Unexpected code ${p.command} in the middle of a chunk.`);
      }
      chunk = Buffer.concat(parts);
    } else {
      throw new DeviceError("PROTOCOL", `The device refused chunk ${start}+${size} (code ${reply.command}).`);
    }
    if (chunk.length !== size) throw new DeviceError("PROTOCOL", `Chunk ${start}+${size} came back with ${chunk.length} bytes.`);
    return chunk;
  }
}

export function assertReadOnly(command: number, data: Buffer): void {
  if (!READ_ONLY_COMMANDS.has(command)) {
    throw new DeviceError("NOT_ALLOWED", `Command ${command} isn't a read. This agent never changes anything on the device.`);
  }
  if (command === CMD.PREPARE_BUFFER && !READ_ONLY_BUFFERED.has(data.length >= 3 ? data.readInt16LE(1) : -1)) {
    throw new DeviceError("NOT_ALLOWED", "The buffered read may only fetch the attendance log.");
  }
}
