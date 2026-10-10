import dgram from "node:dgram";
import net from "node:net";
import { DeviceError } from "../driver";
import { ProtocolError, TcpDeframer, tcpFrame } from "./protocol";

// How packets travel. TCP wraps each packet in an 8-byte top and is a stream
// (packets can be split or joined; the deframer sorts that out); UDP is one
// packet per datagram. Both hand the driver whole packets (header + data).

export interface Transport {
  readonly kind: "tcp" | "udp";
  open(timeoutMs: number): Promise<void>;
  send(packet: Buffer): Promise<void>;
  /** The next packet the device sent; rejects after `timeoutMs`. */
  receive(timeoutMs: number): Promise<Buffer>;
  /** Packets that arrived unasked (a late or trailing reply), dropped before the next command. */
  drain(): number;
  close(): Promise<void>;
}

abstract class QueuedTransport {
  private queue: Buffer[] = [];
  private waiter: { resolve: (b: Buffer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
  private failure: Error | null = null;

  protected deliver(packet: Buffer): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.resolve(packet);
    } else this.queue.push(packet);
  }

  protected fail(err: Error): void {
    this.failure ??= err;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  receive(timeoutMs: number): Promise<Buffer> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new DeviceError("UNREACHABLE", `No reply from the device within ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      this.waiter = { resolve, reject, timer };
    });
  }

  drain(): number {
    const n = this.queue.length;
    this.queue = [];
    return n;
  }
}

export class TcpTransport extends QueuedTransport implements Transport {
  readonly kind = "tcp" as const;
  private socket: net.Socket | null = null;
  private readonly deframer = new TcpDeframer();

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {
    super();
  }

  open(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new DeviceError("UNREACHABLE", `Couldn't connect to ${this.host}:${this.port} (TCP) within ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.setNoDelay(true);
        this.socket = socket;
        resolve();
      });
      socket.on("data", (chunk) => {
        try {
          for (const p of this.deframer.push(chunk)) this.deliver(p);
        } catch (err) {
          this.fail(err instanceof ProtocolError ? new DeviceError("PROTOCOL", err.message) : (err as Error));
          socket.destroy();
        }
      });
      socket.on("error", (err) => {
        clearTimeout(timer);
        const e = new DeviceError("UNREACHABLE", `${this.host}:${this.port} (TCP): ${err.message}`);
        this.fail(e);
        reject(e);
      });
      socket.on("close", () => this.fail(new DeviceError("UNREACHABLE", "The device closed the connection.")));
    });
  }

  send(packet: Buffer): Promise<void> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new DeviceError("UNREACHABLE", "Not connected."));
    return new Promise((resolve, reject) => socket.write(tcpFrame(packet), (err) => (err ? reject(new DeviceError("UNREACHABLE", err.message)) : resolve())));
  }

  close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        socket.destroy();
        resolve();
      }, 1000);
      socket.end(() => {
        clearTimeout(timer);
        socket.destroy();
        resolve();
      });
    });
  }
}

export class UdpTransport extends QueuedTransport implements Transport {
  readonly kind = "udp" as const;
  private socket: dgram.Socket | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {
    super();
  }

  open(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket("udp4");
      const timer = setTimeout(() => {
        socket.close();
        reject(new DeviceError("UNREACHABLE", `Couldn't open UDP to ${this.host}:${this.port}.`));
      }, timeoutMs);
      socket.on("message", (msg) => this.deliver(msg));
      socket.on("error", (err) => {
        const e = new DeviceError("UNREACHABLE", `${this.host}:${this.port} (UDP): ${err.message}`);
        this.fail(e);
        clearTimeout(timer);
        reject(e);
      });
      socket.connect(this.port, this.host, () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
    });
  }

  send(packet: Buffer): Promise<void> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new DeviceError("UNREACHABLE", "Not connected."));
    return new Promise((resolve, reject) => socket.send(packet, (err) => (err ? reject(new DeviceError("UNREACHABLE", err.message)) : resolve())));
  }

  close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return Promise.resolve();
    return new Promise((resolve) => socket.close(() => resolve()));
  }
}
