import { readFileSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compoundFile, writeXls, type TestCell } from "./xlsWriter";

// Stage 9 hardening (docs/plans/STAGE_REPORTS.md, Session A Stage 9, item 4a): hostile spreadsheets fed to the product's upload reader (readGrid: the .xls reader
// for legacy files, ExcelJS for .xlsx). Broken, truncated, encrypted, oversized, huge-row and malformed files, plus seeded random damage to valid ones. Every file
// must end in either a clean read or a clean refusal (an HttpError with a 4xx status and a plain message): never another exception (which would be a 500), never
// a hang, never a memory blow-up. Each file is read in a worker thread with a hard heap cap (WORKER_HEAP_MB) and killed after CASE_TIMEOUT_MS, so a hang or an
// out-of-memory fails the test instead of freezing or killing it. Made-up values only.
const SAMPLES = path.join(__dirname, "..", "..", "..", "..", "docs", "samples");
const sample = (f: string) => readFileSync(path.join(SAMPLES, f));
const MAX_BYTES = 10 * 1024 * 1024; // the swipes/statement upload limit
const WORKER_HEAP_MB = 256;
const CASE_TIMEOUT_MS = 5_000; // a hang, not a slow read: a good file of this size reads in milliseconds
const SLOW_MS = 2_000; // no single file may take longer than this to read or refuse

type Outcome =
  | { ok: true; rows: number; cells: number; ms: number; heapMb: number }
  | { ok: false; http: boolean; status: number; code: string; message: string; ms: number; heapMb: number }
  | { hang: true }
  | { crash: string };

/** A persistent reader thread; respawned after a hang or a crash. */
class Reader {
  private worker: Worker | null = null;
  private next = 0;
  private spawn(): Worker {
    this.worker = new Worker(path.join(__dirname, "xlsHardeningWorker.ts"), { execArgv: ["--import", "tsx"], resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB, maxYoungGenerationSizeMb: 32 } });
    return this.worker;
  }
  read(buf: Buffer, maxBytes = MAX_BYTES): Promise<Outcome> {
    const w = this.worker ?? this.spawn();
    const id = ++this.next;
    return new Promise((resolve) => {
      const done = (o: Outcome, kill: boolean) => {
        clearTimeout(timer);
        w.off("message", onMsg);
        w.off("error", onErr);
        w.off("exit", onExit);
        if (kill) {
          void w.terminate();
          this.worker = null;
        }
        resolve(o);
      };
      const onMsg = (m: Outcome & { id: number }) => m.id === id && done(m, false);
      const onErr = (e: Error & { code?: string }) => done({ crash: e.code ?? e.message }, true);
      const onExit = (code: number) => done({ crash: `exit ${code}` }, true);
      const timer = setTimeout(() => done({ hang: true }, true), CASE_TIMEOUT_MS);
      w.on("message", onMsg);
      w.once("error", onErr);
      w.once("exit", onExit);
      w.postMessage({ id, buf, maxBytes });
    });
  }
  async close() {
    await this.worker?.terminate();
  }
}

/** Seeded so a failure can be replayed exactly. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const rec = (type: number, data: Buffer, len = data.length) => Buffer.concat([u16(type), u16(len), data]);
const BOF_GLOBALS = rec(0x0809, Buffer.concat([u16(0x0600), u16(0x0005), Buffer.alloc(12)]));
const BOF_SHEET = rec(0x0809, Buffer.concat([u16(0x0600), u16(0x0010), Buffer.alloc(12)]));
const EOF = rec(0x000a, Buffer.alloc(0));
/** A workbook stream with one sheet whose records are `cells` (raw), so a test can write records no writer would. */
function rawWorkbook(cells: Buffer[], globalsExtra: Buffer[] = [], sheetOffset?: number): Buffer {
  const name = Buffer.concat([Buffer.from([5, 0]), Buffer.from("Sheet")]);
  const boundLen = 4 + 6 + name.length;
  const globalsLen = BOF_GLOBALS.length + globalsExtra.reduce((n, b) => n + b.length, 0) + boundLen + EOF.length;
  const bound = rec(0x0085, Buffer.concat([u32(sheetOffset ?? globalsLen), Buffer.from([0, 0]), name]));
  return compoundFile("Workbook", Buffer.concat([BOF_GLOBALS, ...globalsExtra, bound, EOF, BOF_SHEET, ...cells, EOF]));
}
const cellHead = (r: number, c: number) => Buffer.concat([u16(r), u16(c), u16(0x0f)]);
const rk = (r: number, c: number, v: number) => rec(0x027e, Buffer.concat([cellHead(r, c), u32(((v << 2) | 2) >>> 0)]));

// A small valid swipes-shaped workbook: the base for the structural damage below.
const BASE_ROWS: TestCell[][] = [["Employee Number", "Employee Name", "In/Out Status", "Door Name", "Date & Time"], ...Array.from({ length: 40 }, (_, i) => [`ZZ${1000 + i}`, "Test person", i % 2 ? "Out" : "In", "Main", `05/08/2026 0${i % 10}:15`])];
const base = () => writeXls([{ name: "Sheet1", rows: BASE_ROWS }], { sst: true, splitAt: 300 });
const SECTOR = 512;
/** In the writer's compound file: header, W data sectors, then the directory sector, then the allocation table. */
const layout = (buf: Buffer) => {
  const W = buf.readUInt32LE(0x4c) - 1; // the first FAT sector comes right after the directory
  return { W, dirAt: (W + 1) * SECTOR, fatAt: (W + 2) * SECTOR };
};
const patch = (buf: Buffer, fn: (b: Buffer) => void) => {
  const b = Buffer.from(buf);
  fn(b);
  return b;
};

describe("Stage 9 hardening — hostile spreadsheets never crash, hang or blow up the reader", () => {
  const reader = new Reader();
  const seen: Array<{ label: string; o: Outcome }> = [];
  const read = async (label: string, buf: Buffer, maxBytes?: number) => {
    const o = await reader.read(buf, maxBytes);
    seen.push({ label, o });
    return o;
  };
  /** A clean refusal: an HttpError, 4xx, with a code and a plain message, fast, inside the heap cap. */
  const refused = (label: string, o: Outcome, code?: string | RegExp, message?: RegExp) => {
    expect("hang" in o ? "HANG" : "crash" in o ? `CRASH ${o.crash}` : "ok", label).toBe("ok");
    if ("hang" in o || "crash" in o) return;
    expect(o.ok, `${label}: read instead of refused`).toBe(false);
    if (o.ok) return;
    expect([o.http, o.status >= 400 && o.status < 500], `${label}: ${o.code} ${o.message}`).toEqual([true, true]);
    if (code) expect(o.code, label).toMatch(code);
    if (message) expect(o.message, label).toMatch(message);
    expect(o.ms, `${label} took ${Math.round(o.ms)} ms`).toBeLessThan(SLOW_MS);
  };
  /** Either outcome is acceptable, as long as it is clean. */
  const clean = (label: string, o: Outcome) => {
    expect("hang" in o ? "HANG" : "crash" in o ? `CRASH ${o.crash}` : "ok", label).toBe("ok");
    if ("hang" in o || "crash" in o) return;
    if (!o.ok) expect([o.http, o.status >= 400 && o.status < 500], `${label}: ${o.code} ${o.message}`).toEqual([true, true]);
    expect(o.ms, `${label} took ${Math.round(o.ms)} ms`).toBeLessThan(SLOW_MS);
  };

  beforeAll(async () => {
    const warm = await reader.read(base()); // the first read pays the worker's start-up
    expect(warm).toMatchObject({ ok: true, rows: BASE_ROWS.length });
  }, 60_000);
  afterAll(async () => {
    await reader.close();
    const worst = seen.reduce((m, s) => ("ms" in s.o && s.o.ms > m.ms ? { ms: s.o.ms, label: s.label } : m), { ms: 0, label: "" });
    const heap = Math.max(...seen.map((s) => ("heapMb" in s.o ? s.o.heapMb : 0)));
    console.log(`[xls hardening] ${seen.length} files; slowest ${Math.round(worst.ms)} ms (${worst.label}); worker heap peak ${Math.round(heap)} MB of ${WORKER_HEAP_MB}`);
  });

  it("broken: not a spreadsheet at all, or an .xls signature followed by garbage", async () => {
    refused("empty", await read("empty", Buffer.alloc(0)), "EMPTY_FILE");
    refused("text", await read("text", Buffer.from("EmployeeNo,Name\nZZ1,Test\n")), "WRONG_FILE_TYPE");
    refused("pdf", await read("pdf", Buffer.from("%PDF-1.4\n%made up\n")), "WRONG_FILE_TYPE");
    const rnd = prng(9001);
    for (let i = 0; i < 25; i++) {
      const size = 512 + Math.floor(rnd() * 20_000);
      const b = Buffer.from(Array.from({ length: size }, () => Math.floor(rnd() * 256)));
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(b, 0);
      refused(`garbage ${i}`, await read(`garbage ${i}`, b), "UNREADABLE_FILE");
    }
    refused("zip garbage", await read("zip garbage", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2000, 7)])), "UNREADABLE_FILE");
  }, 120_000);

  it("truncated: a valid .xls or .xlsx cut short anywhere is refused or (if only padding was lost) read, never half-crashed", async () => {
    for (const [name, full] of [["generated", base()], ["statement", sample("Salary_Statement_template.xls")], ["bank", sample("Bank_Transfer_template.xls")], ["swipes xlsx", sample("Attendance_Swipes_template.xlsx")]] as const) {
      for (let k = 1; k < 40; k++) {
        const cut = Math.floor((full.length * k) / 40);
        clean(`${name} cut at ${cut}`, await read(`${name} cut at ${cut}`, full.subarray(0, cut)));
      }
    }
    // Cut inside the header or the directory: always refused.
    refused("cut in header", await read("cut in header", base().subarray(0, 300)));
    const b = base();
    refused("cut before directory", await read("cut before directory", b.subarray(0, layout(b).dirAt)), "UNREADABLE_FILE");
  }, 180_000);

  it("encrypted: a password-protected workbook is refused and says so, whichever way it is marked", async () => {
    refused("FILEPASS", await read("FILEPASS", writeXls([{ name: "S", rows: [["x"]] }], { encrypted: true })), "UNREADABLE_FILE", /password/);
    refused("EncryptionInfo stream", await read("EncryptionInfo stream", compoundFile("EncryptionInfo", Buffer.alloc(100, 1))), "UNREADABLE_FILE", /password/);
  });

  it("oversized: a file over the limit is refused before it is parsed", async () => {
    const o = await read("oversized", Buffer.concat([base(), Buffer.alloc(MAX_BYTES)]));
    refused("oversized", o, "FILE_TOO_LARGE");
    if (!("hang" in o) && !("crash" in o) && !o.ok) expect(o.status).toBe(413);
  }, 60_000);

  it("huge rows: a 256-column row of long text reads; a cell past column 256 is refused; a sparse sheet that would inflate in memory is refused", async () => {
    const wide = await read("wide row", writeXls([{ name: "S", rows: [Array.from({ length: 256 }, (_, c) => `${"long text ".repeat(20)}${c}`)] }], { sst: true }));
    expect(wide).toMatchObject({ ok: true, rows: 1, cells: 256 });
    const last = await read("last row", rawWorkbook([rk(65_535, 0, 1)]));
    expect(last).toMatchObject({ ok: true, rows: 65_536 });
    refused("column 256", await read("column 256", rawWorkbook([rk(0, 256, 1)])), "UNREADABLE_FILE", /larger/);
    const mulrk = rec(0x00bd, Buffer.concat([u16(0), u16(200), ...Array.from({ length: 100 }, () => Buffer.concat([u16(0x0f), u32(6)])), u16(299)]));
    refused("MULRK past column 256", await read("MULRK past column 256", mulrk.length < 8300 ? rawWorkbook([mulrk]) : rawWorkbook([])), "UNREADABLE_FILE", /larger/);
    // One cell at the far right of every possible row: under 1 MB on disk, but 16.7 million grid slots if the reader padded every row to column 255.
    const sparse = rawWorkbook(Array.from({ length: 65_536 }, (_, r) => rk(r, 255, 1)));
    expect(sparse.length).toBeLessThan(MAX_BYTES);
    refused("sparse far-right cells", await read("sparse far-right cells", sparse), "UNREADABLE_FILE", /too many cells/);
  }, 120_000);

  it("malformed structure: every lie a file can tell about itself is refused in plain words", async () => {
    const b = base();
    const { dirAt, fatAt } = layout(b);
    const cases: Array<[string, Buffer, RegExp?]> = [
      ["unknown sector size", patch(b, (x) => x.writeUInt16LE(16, 0x1e)), /sector size/],
      ["unknown mini sector size", patch(b, (x) => x.writeUInt16LE(9, 0x20)), /mini sector/],
      ["sector chain loop", patch(b, (x) => x.writeUInt32LE(0, fatAt)), /loop/],
      ["sector list loop", patch(b, (x) => { x.writeUInt32LE(0, 0x44); x.writeUInt32LE(0, SECTOR + SECTOR - 4); }), /loop|damaged/],
      ["directory past the end", patch(b, (x) => x.writeUInt32LE(0x00ff_fff0, 0x30)), /damaged/],
      ["FAT sector past the end", patch(b, (x) => x.writeUInt32LE(0x00ff_fff0, 0x4c)), /damaged/],
      ["no root entry", patch(b, (x) => x.writeUInt8(0, dirAt + 0x42)), /root/],
      ["stream longer than its chain", patch(b, (x) => x.writeUInt32LE(0x7fff_ffff, dirAt + 128 + 0x78)), /shorter/],
      ["directory name length absurd", patch(b, (x) => x.writeUInt16LE(0xffff, dirAt + 128 + 0x40)), /no workbook/],
      ["Excel 5 workbook", compoundFile("Book", Buffer.alloc(100)), /Excel 5/],
      ["no workbook stream", compoundFile("Something", Buffer.alloc(100)), /no workbook/],
      ["older BIFF version", writeXls([{ name: "S", rows: [["x"]] }], { version: 0x0500 }), /97-2003/],
      ["no workbook header", compoundFile("Workbook", Buffer.concat([EOF, BOF_GLOBALS])), /header/],
      ["record past the end", compoundFile("Workbook", Buffer.concat([BOF_GLOBALS, u16(0x0204), u16(0xffff), Buffer.alloc(10)])), /past its end/],
      ["string table claims a million strings", rawWorkbook([], [rec(0x00fc, Buffer.concat([u32(1_000_000), u32(1_000_000)]))]), /ends early/],
      ["string table claims too many strings", rawWorkbook([], [rec(0x00fc, Buffer.concat([u32(9_000_000), u32(9_000_000)]))]), /too many/],
      ["string table string longer than the table", rawWorkbook([], [rec(0x00fc, Buffer.concat([u32(1), u32(1), u16(0xffff), Buffer.from([0]), Buffer.from("abc")]))]), /ends early/],
      ["string table rich-text runs past the end", rawWorkbook([], [rec(0x00fc, Buffer.concat([u32(1), u32(1), u16(1), Buffer.from([0x0c]), u16(0xffff), u32(0xffff_ffff), Buffer.from("a")]))]), /ends early/],
      ["label longer than its record", rawWorkbook([rec(0x0204, Buffer.concat([cellHead(0, 0), u16(0xffff), Buffer.from([0]), Buffer.from("abc")]))]), /runs past/],
      ["label with rich-text count cut off", rawWorkbook([rec(0x0204, Buffer.concat([cellHead(0, 0), u16(1), Buffer.from([0x08])]))]), /damaged/],
      ["label with extended data cut off", rawWorkbook([rec(0x0204, Buffer.concat([cellHead(0, 0), u16(1), Buffer.from([0x04, 0])]))]), /damaged/],
      ["label with no length", rawWorkbook([rec(0x0204, cellHead(0, 0))]), /damaged/],
      ["formula text with no length", rawWorkbook([rec(0x0006, Buffer.concat([cellHead(0, 0), Buffer.from([0, 0, 0, 0, 0, 0, 0xff, 0xff]), u16(0), u32(0)])), rec(0x0207, Buffer.alloc(1))]), /damaged/],
      ["sheet that cannot be found", rawWorkbook([rk(0, 0, 1)], [], 0x7fff_0000), /cannot be found/],
      ["sheet inside a sheet", rawWorkbook([rk(0, 0, 1), BOF_SHEET]), /sheet inside/],
    ];
    for (const [label, file, message] of cases) refused(label, await read(label, file), "UNREADABLE_FILE", message);
  }, 120_000);

  it("seeded random damage: 600 valid files with bytes flipped, inserted or deleted all end cleanly", async () => {
    const rnd = prng(20261116);
    const originals = [base(), sample("Salary_Statement_template.xls"), sample("Bank_Transfer_template.xls")];
    const tally = { read: 0, refused: 0 };
    for (let i = 0; i < 600; i++) {
      const src = originals[i % originals.length]!;
      let b = Buffer.from(src);
      const edits = 1 + Math.floor(rnd() * 8);
      for (let e = 0; e < edits; e++) {
        // Mostly where the structure lives (the header, the directory, the records' heads), sometimes anywhere.
        const at = rnd() < 0.7 ? Math.floor(rnd() * Math.min(b.length, 6000)) : Math.floor(rnd() * b.length);
        const kind = rnd();
        if (kind < 0.7) b[at] = Math.floor(rnd() * 256);
        else if (kind < 0.85) b = Buffer.concat([b.subarray(0, at), Buffer.from([Math.floor(rnd() * 256)]), b.subarray(at)]);
        else b = Buffer.concat([b.subarray(0, at), b.subarray(at + 1)]);
      }
      const o = await read(`mutation ${i}`, b);
      clean(`mutation ${i} (seed 20261116)`, o);
      if ("ok" in o) tally[o.ok ? "read" : "refused"]++;
    }
    expect(tally.read + tally.refused).toBe(600);
    expect(tally.refused).toBeGreaterThan(0);
  }, 300_000);
});
