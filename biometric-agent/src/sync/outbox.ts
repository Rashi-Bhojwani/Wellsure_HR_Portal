import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { MAX_AGENT_BATCH_LINES } from "@shared/attendance/agentProtocol";
import { writeFileDurably } from "./files";

// The on-disk outbox (D-F2). Records read from a device are written here,
// flushed to disk, BEFORE the device cursor moves; a file is deleted only when
// the API acknowledges it. So a long API outage can't leave punches only on
// the device (where they could be overwritten), and a crash at any step
// re-sends rather than loses: the server drops exact duplicates.
//
// One folder per device; one file per future POST (at most 1,000 ATTLOG
// lines), named so they sort oldest first. Sent strictly in order per device.

export interface Segment {
  serial: string;
  file: string;
  lines: string[];
  oldestLocalTime: string | null;
}

/** A set-aside batch (not its `.reason.json` companion). */
const isBatchFile = (f: string) => f.endsWith(".json") && !f.endsWith(".reason.json");

export interface QuarantinedBatch {
  name: string;
  serial: string;
  lines: string[];
  oldestLocalTime: string | null;
  refusedAt: string | null;
  reason: string;
}

const folderFor = (serial: string) => serial.replace(/[^A-Za-z0-9_-]/g, "_");

export class Outbox {
  private readonly root: string;
  private readonly quarantine: string;
  private counter = 0;
  /** Lines waiting, per serial (kept in step with the files). */
  private readonly pending = new Map<string, { lines: number; oldest: string | null }>();

  constructor(dataDir: string) {
    this.root = path.join(dataDir, "outbox");
    this.quarantine = path.join(dataDir, "outbox-rejected");
  }

  /** Scans what's on disk (after a restart), dropping half-written files. */
  init(): void {
    mkdirSync(this.root, { recursive: true });
    this.pending.clear();
    for (const folder of readdirSync(this.root)) {
      const dir = path.join(this.root, folder);
      for (const f of readdirSync(dir)) if (f.endsWith(".tmp")) rmSync(path.join(dir, f));
      for (const seg of this.segmentsIn(dir)) this.track(seg.serial, seg.lines.length, seg.oldestLocalTime);
    }
  }

  private segmentsIn(dir: string): Segment[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        const file = path.join(dir, f);
        const body = JSON.parse(readFileSync(file, "utf8")) as { serial: string; lines: string[]; oldestLocalTime: string | null };
        return { serial: body.serial, file, lines: body.lines, oldestLocalTime: body.oldestLocalTime };
      });
  }

  private track(serial: string, lines: number, oldest: string | null): void {
    const cur = this.pending.get(serial) ?? { lines: 0, oldest: null };
    cur.lines += lines;
    if (oldest && (!cur.oldest || oldest < cur.oldest)) cur.oldest = oldest;
    this.pending.set(serial, cur);
  }

  /** Writes ATTLOG lines (with their device-local times) durably, as one or more batches. */
  append(serial: string, entries: Array<{ line: string; localTime: string }>): number {
    const dir = path.join(this.root, folderFor(serial));
    for (let i = 0; i < entries.length; i += MAX_AGENT_BATCH_LINES) {
      const batch = entries.slice(i, i + MAX_AGENT_BATCH_LINES);
      const oldest = batch.reduce<string | null>((m, e) => (!m || e.localTime < m ? e.localTime : m), null);
      const name = `${String(Date.now()).padStart(15, "0")}-${String(this.counter++).padStart(8, "0")}.json`;
      writeFileDurably(path.join(dir, name), JSON.stringify({ serial, lines: batch.map((e) => e.line), oldestLocalTime: oldest }));
      this.track(serial, batch.length, oldest);
    }
    return entries.length;
  }

  oldest(serial: string): Segment | null {
    return this.segmentsIn(path.join(this.root, folderFor(serial)))[0] ?? null;
  }

  /** The API acknowledged it. */
  remove(seg: Segment): void {
    rmSync(seg.file, { force: true });
    this.recount(seg.serial);
  }

  /**
   * The API refused the batch itself (it will never be accepted as is): kept
   * aside for a person, never deleted, with the reason it was refused beside
   * it. The heartbeat reports how many are waiting, so HR sees a banner until
   * someone deals with them (`quarantine` command, INSTALL.md).
   */
  quarantineSegment(seg: Segment, reason = "(no reason recorded)", now: Date = new Date()): void {
    mkdirSync(this.quarantine, { recursive: true });
    const name = `${folderFor(seg.serial)}-${path.basename(seg.file)}`;
    renameSync(seg.file, path.join(this.quarantine, name));
    writeFileDurably(path.join(this.quarantine, name.replace(/\.json$/, ".reason.json")), JSON.stringify({ refusedAt: now.toISOString(), reason }));
    this.recount(seg.serial);
  }

  quarantinedCount(): number {
    return existsSync(this.quarantine) ? readdirSync(this.quarantine).filter(isBatchFile).length : 0;
  }

  /** What is set aside, oldest first: for the `quarantine` command. */
  quarantined(): QuarantinedBatch[] {
    if (!existsSync(this.quarantine)) return [];
    return readdirSync(this.quarantine)
      .filter(isBatchFile)
      .sort()
      .map((name) => {
        const file = path.join(this.quarantine, name);
        const body = JSON.parse(readFileSync(file, "utf8")) as { serial: string; lines: string[]; oldestLocalTime: string | null };
        const reasonFile = path.join(this.quarantine, name.replace(/\.json$/, ".reason.json"));
        const why = existsSync(reasonFile) ? (JSON.parse(readFileSync(reasonFile, "utf8")) as { refusedAt?: string; reason?: string }) : {};
        return { name, serial: body.serial, lines: body.lines, oldestLocalTime: body.oldestLocalTime, refusedAt: why.refusedAt ?? null, reason: why.reason ?? "(no reason recorded)" };
      });
  }

  /**
   * Writes every set-aside batch as a plain ATTLOG text file that Import
   * Center → Device punches accepts (the same lines, one punch per line).
   */
  exportQuarantined(toDir: string): string[] {
    mkdirSync(toDir, { recursive: true });
    return this.quarantined().map((b) => {
      const file = path.join(toDir, b.name.replace(/\.json$/, ".attlog.txt"));
      writeFileDurably(file, `${b.lines.join("\n")}\n`);
      return file;
    });
  }

  /** A person has dealt with them: moved to `outbox-rejected/handled/`, still not deleted, and the banner clears. */
  markQuarantinedHandled(): number {
    const handled = path.join(this.quarantine, "handled");
    mkdirSync(handled, { recursive: true });
    let n = 0;
    for (const name of readdirSync(this.quarantine)) {
      if (!name.endsWith(".json")) continue;
      if (isBatchFile(name)) n++;
      renameSync(path.join(this.quarantine, name), path.join(handled, name));
    }
    return n;
  }

  private recount(serial: string): void {
    this.pending.delete(serial);
    for (const seg of this.segmentsIn(path.join(this.root, folderFor(serial)))) this.track(serial, seg.lines.length, seg.oldestLocalTime);
  }

  waiting(serial: string): { lines: number; oldest: string | null } {
    return this.pending.get(serial) ?? { lines: 0, oldest: null };
  }

  serialsWaiting(): string[] {
    return [...this.pending.entries()].filter(([, v]) => v.lines > 0).map(([k]) => k);
  }

  total(): number {
    let n = 0;
    for (const v of this.pending.values()) n += v.lines;
    return n;
  }
}
