// A small, read-only reader for legacy Excel files (.xls, BIFF8 inside a compound file), for the greytHR readers of Stage 8 (docs/plans/STAGE_8_PLAN.md).
// It reads cell values only: shared strings, labels, numbers, RK numbers, booleans and a formula's CACHED result. It never evaluates a formula, never reads a
// macro (the VBA storage is not opened), refuses encrypted files and the older Excel 5 format, and bounds every loop by the file's own size. Nothing is logged.

export type XlsCell = string | number | boolean | null;
export interface XlsSheet {
  name: string;
  rows: XlsCell[][];
}
export interface XlsWorkbook {
  sheets: XlsSheet[];
}

/** A problem with the file itself, worded for the person who uploaded it. */
export class XlsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsError";
  }
}

const SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;
const MAX_CELLS = 1_000_000;
const MAX_ROWS = 65_536;
const MAX_COLS = 256;

/** True when the bytes start like a compound file (a legacy .xls, .doc ...). */
export const looksLikeXls = (buf: Buffer): boolean => buf.length >= 512 && buf.subarray(0, 8).equals(SIGNATURE);

function cfbStream(buf: Buffer, wanted: readonly string[]): { name: string; data: Buffer } {
  if (!looksLikeXls(buf)) throw new XlsError("This is not a legacy Excel (.xls) file.");
  const sectorShift = buf.readUInt16LE(0x1e);
  const miniShift = buf.readUInt16LE(0x20);
  if (sectorShift !== 9 && sectorShift !== 12) throw new XlsError("The file is damaged (unknown sector size).");
  if (miniShift !== 6) throw new XlsError("The file is damaged (unknown mini sector size).");
  const sectorSize = 1 << sectorShift;
  const totalSectors = Math.floor((buf.length - sectorSize) / sectorSize) + 1;
  const sectorAt = (n: number): Buffer => {
    const start = (n + 1) * sectorSize;
    if (n < 0 || start >= buf.length) throw new XlsError("The file is damaged (a sector points past its end).");
    return buf.subarray(start, Math.min(start + sectorSize, buf.length));
  };
  // The sector allocation table: its sectors are listed in the header (109) and then in a chain of extra list sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = buf.readUInt32LE(0x4c + i * 4);
    if (s !== FREE) fatSectors.push(s);
  }
  let difat = buf.readUInt32LE(0x44);
  for (let guard = 0; difat !== END_OF_CHAIN && difat !== FREE; guard++) {
    if (guard > totalSectors) throw new XlsError("The file is damaged (a loop in its sector lists).");
    const sec = sectorAt(difat);
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const s = sec.readUInt32LE(i * 4);
      if (s !== FREE) fatSectors.push(s);
    }
    difat = sec.readUInt32LE(sectorSize - 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const sec = sectorAt(s);
    for (let i = 0; i + 4 <= sec.length; i += 4) fat.push(sec.readUInt32LE(i));
  }
  const chain = (start: number, table: number[], limit: number): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let s = start; s !== END_OF_CHAIN && s !== FREE; s = table[s] ?? END_OF_CHAIN) {
      if (seen.has(s) || out.length > limit) throw new XlsError("The file is damaged (a loop in a sector chain).");
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number): Buffer => Buffer.concat(chain(start, fat, totalSectors).map(sectorAt));
  const dir = readChain(buf.readUInt32LE(0x30));
  const entries: Array<{ name: string; type: number; start: number; size: number }> = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLen = dir.readUInt16LE(off + 0x40);
    const type = dir.readUInt8(off + 0x42);
    if (type === 0 || nameLen < 2 || nameLen > 64) {
      entries.push({ name: "", type: 0, start: 0, size: 0 });
      continue;
    }
    entries.push({ name: dir.subarray(off, off + nameLen - 2).toString("utf16le"), type, start: dir.readUInt32LE(off + 0x74), size: dir.readUInt32LE(off + 0x78) });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw new XlsError("The file is damaged (no root entry).");
  if (entries.some((e) => (e.type === 1 || e.type === 2) && (e.name === "EncryptionInfo" || e.name === `${String.fromCharCode(6)}DataSpaces`))) throw new XlsError("The file is password-protected. Save it again without a password.");
  const found = entries.find((e) => e.type === 2 && wanted.includes(e.name));
  if (!found) {
    if (entries.some((e) => e.type === 2 && e.name === "Book")) throw new XlsError("This is an Excel 5 file, which is not read. Save it again as Excel 97-2003 (.xls) or as .xlsx.");
    throw new XlsError("This is not an Excel workbook (no workbook stream inside).");
  }
  const cutoff = buf.readUInt32LE(0x38);
  let data: Buffer;
  if (found.size < cutoff) {
    // Small streams live in the mini stream, 64-byte pieces chained by the mini allocation table.
    const miniStream = readChain(root.start);
    const miniFatBytes = readChain(buf.readUInt32LE(0x3c));
    const miniFat: number[] = [];
    for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(miniFatBytes.readUInt32LE(i));
    const pieces = chain(found.start, miniFat, miniStream.length / 64 + 1).map((m) => {
      if ((m + 1) * 64 > miniStream.length) throw new XlsError("The file is damaged (a mini sector points past its end).");
      return miniStream.subarray(m * 64, m * 64 + 64);
    });
    data = Buffer.concat(pieces);
  } else data = readChain(found.start);
  if (data.length < found.size) throw new XlsError("The file is damaged (a stream is shorter than it says).");
  return { name: found.name, data: data.subarray(0, found.size) };
}

interface Rec {
  type: number;
  data: Buffer;
  offset: number;
}

function records(stream: Buffer): Rec[] {
  const out: Rec[] = [];
  let off = 0;
  while (off + 4 <= stream.length) {
    const type = stream.readUInt16LE(off);
    const len = stream.readUInt16LE(off + 2);
    if (off + 4 + len > stream.length) throw new XlsError("The file is damaged (a record runs past its end).");
    out.push({ type, data: stream.subarray(off + 4, off + 4 + len), offset: off });
    off += 4 + len;
  }
  return out;
}

/** Reads strings that may continue across CONTINUE records (each continuation of characters starts with a fresh compression flag). */
class Segments {
  private seg = 0;
  private pos = 0;
  constructor(private readonly parts: Buffer[]) {}
  private ensure(): void {
    while (this.seg < this.parts.length && this.pos >= this.parts[this.seg]!.length) {
      this.seg++;
      this.pos = 0;
    }
    if (this.seg >= this.parts.length) throw new XlsError("The file is damaged (its string table ends early).");
  }
  u8(): number {
    this.ensure();
    return this.parts[this.seg]!.readUInt8(this.pos++);
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n: number): void {
    for (let i = 0; i < n; i++) this.u8();
  }
  chars(count: number, wide: boolean): string {
    let out = "";
    let isWide = wide;
    let left = count;
    while (left > 0) {
      if (this.seg >= this.parts.length) throw new XlsError("The file is damaged (its string table ends early).");
      const part = this.parts[this.seg]!;
      const per = isWide ? 2 : 1;
      const fit = Math.min(left, Math.floor((part.length - this.pos) / per));
      if (fit === 0) {
        // The characters continue in the next record, which starts with its own compression flag.
        this.seg++;
        this.pos = 0;
        if (this.seg >= this.parts.length || this.parts[this.seg]!.length === 0) throw new XlsError("The file is damaged (its string table ends early).");
        isWide = (this.parts[this.seg]!.readUInt8(this.pos++) & 1) === 1;
        continue;
      }
      out += isWide ? part.subarray(this.pos, this.pos + fit * 2).toString("utf16le") : part.subarray(this.pos, this.pos + fit).toString("latin1");
      this.pos += fit * per;
      left -= fit;
    }
    return out;
  }
}

function unicodeString(data: Buffer, off: number, lenBytes: 1 | 2): { text: string; next: number } {
  if (off + lenBytes + 1 > data.length) throw new XlsError("The file is damaged (a short string).");
  const cch = lenBytes === 1 ? data.readUInt8(off) : data.readUInt16LE(off);
  const flags = data.readUInt8(off + lenBytes);
  let p = off + lenBytes + 1;
  const rich = flags & 0x08 ? data.readUInt16LE(p) : 0;
  if (flags & 0x08) p += 2;
  const ext = flags & 0x04 ? data.readUInt32LE(p) : 0;
  if (flags & 0x04) p += 4;
  const wide = (flags & 1) === 1;
  const bytes = cch * (wide ? 2 : 1);
  if (p + bytes > data.length) throw new XlsError("The file is damaged (a string runs past its record).");
  const text = wide ? data.subarray(p, p + bytes).toString("utf16le") : data.subarray(p, p + bytes).toString("latin1");
  return { text, next: p + bytes + rich * 4 + ext };
}

function rkValue(rk: number): number {
  let v: number;
  if (rk & 2) v = rk >> 2; // a 30-bit signed integer
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(rk & 0xfffffffc, 4);
    v = b.readDoubleLE(0);
  }
  return rk & 1 ? v / 100 : v;
}

/** Reads every worksheet's cell values. Throws XlsError with a plain message for a file that is not a readable .xls. */
export function readXls(buf: Buffer): XlsWorkbook {
  const { data } = cfbStream(buf, ["Workbook"]);
  const recs = records(data);
  const first = recs[0];
  if (!first || first.type !== 0x0809 || first.data.length < 4) throw new XlsError("The file is damaged (no workbook header).");
  if (first.data.readUInt16LE(0) !== 0x0600) throw new XlsError("Only Excel 97-2003 (.xls) workbooks are read. Save it again in that format or as .xlsx.");
  const sheetsAt: Array<{ name: string; offset: number }> = [];
  let sst: string[] = [];
  let i = 0;
  for (; i < recs.length; i++) {
    const r = recs[i]!;
    if (r.type === 0x002f) throw new XlsError("The file is password-protected. Save it again without a password.");
    if (r.type === 0x0085 && r.data.length >= 8) {
      const visibleSheet = r.data.readUInt8(5) === 0; // 0 = a worksheet (not a chart or a macro sheet)
      const name = unicodeString(r.data, 6, 1).text;
      if (visibleSheet) sheetsAt.push({ name, offset: r.data.readUInt32LE(0) });
    }
    if (r.type === 0x00fc) {
      const parts = [r.data];
      for (let j = i + 1; j < recs.length && recs[j]!.type === 0x003c; j++) parts.push(recs[j]!.data);
      const s = new Segments(parts);
      s.u32();
      const unique = s.u32();
      if (unique > MAX_CELLS) throw new XlsError("The file has too many strings to be read.");
      sst = [];
      for (let k = 0; k < unique; k++) {
        const cch = s.u16();
        const flags = s.u8();
        const runs = flags & 0x08 ? s.u16() : 0;
        const ext = flags & 0x04 ? s.u32() : 0;
        sst.push(s.chars(cch, (flags & 1) === 1));
        s.skip(runs * 4 + ext);
      }
    }
    if (r.type === 0x000a) break; // end of the workbook globals
  }
  const byOffset = new Map(recs.map((r, idx) => [r.offset, idx]));
  let cells = 0;
  const sheets: XlsSheet[] = [];
  for (const sh of sheetsAt) {
    const start = byOffset.get(sh.offset);
    if (start === undefined) throw new XlsError(`The file is damaged (sheet "${sh.name}" cannot be found).`);
    const grid: XlsCell[][] = [];
    const put = (row: number, col: number, v: XlsCell) => {
      if (row >= MAX_ROWS || col >= MAX_COLS) throw new XlsError("The sheet is larger than an .xls file can be.");
      if (++cells > MAX_CELLS) throw new XlsError("The file has too many cells to be read.");
      while (grid.length <= row) grid.push([]);
      const line = grid[row]!;
      while (line.length <= col) line.push(null);
      line[col] = v;
    };
    let pendingFormula: { row: number; col: number } | null = null;
    for (let k = start + 1; k < recs.length; k++) {
      const r = recs[k]!;
      const d = r.data;
      if (r.type === 0x000a) break;
      if (r.type === 0x0809) throw new XlsError("The file is damaged (a sheet inside a sheet).");
      if (d.length < 6 && r.type !== 0x0207) continue;
      switch (r.type) {
        case 0x00fd: // LABELSST
          if (d.length >= 10) {
            const idx = d.readUInt32LE(6);
            put(d.readUInt16LE(0), d.readUInt16LE(2), sst[idx] ?? "");
          }
          break;
        case 0x0203: // NUMBER
          if (d.length >= 14) put(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6));
          break;
        case 0x027e: // RK
          if (d.length >= 10) put(d.readUInt16LE(0), d.readUInt16LE(2), rkValue(d.readUInt32LE(6)));
          break;
        case 0x00bd: {
          // MULRK
          const row = d.readUInt16LE(0);
          const firstCol = d.readUInt16LE(2);
          const n = Math.floor((d.length - 6) / 6);
          for (let c = 0; c < n; c++) put(row, firstCol + c, rkValue(d.readUInt32LE(4 + c * 6 + 2)));
          break;
        }
        case 0x0204: // LABEL
          put(d.readUInt16LE(0), d.readUInt16LE(2), unicodeString(d, 6, 2).text);
          break;
        case 0x0205: // BOOLERR: a boolean, or an error shown as empty
          if (d.length >= 8) put(d.readUInt16LE(0), d.readUInt16LE(2), d.readUInt8(7) === 0 ? d.readUInt8(6) === 1 : null);
          break;
        case 0x0006: {
          // FORMULA: only the cached result is read; the formula itself is never evaluated.
          if (d.length < 14) break;
          const row = d.readUInt16LE(0);
          const col = d.readUInt16LE(2);
          if (d.readUInt16LE(12) === 0xffff) {
            const kind = d.readUInt8(6);
            if (kind === 0) pendingFormula = { row, col }; // the string follows in a STRING record
            else if (kind === 1) put(row, col, d.readUInt8(8) === 1);
            else put(row, col, null);
          } else put(row, col, d.readDoubleLE(6));
          break;
        }
        case 0x0207: // STRING (a formula's cached text)
          if (pendingFormula) {
            put(pendingFormula.row, pendingFormula.col, unicodeString(d, 0, 2).text);
            pendingFormula = null;
          }
          break;
      }
    }
    sheets.push({ name: sh.name, rows: grid });
  }
  return { sheets };
}
