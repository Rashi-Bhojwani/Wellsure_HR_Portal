// Test-only: writes small legacy Excel (.xls, BIFF8 in a compound file) workbooks so the reader and the greytHR readers can be tested with generated data
// (docs/plans/STAGE_8_PLAN.md). Made-up values only. Not used by the product.

export type TestCell = string | number | boolean | null | { formula: number | string } | { rk: number };
export interface TestSheet {
  name: string;
  rows: TestCell[][];
}
export interface WriteOptions {
  /** Put strings in a shared string table (as Excel does); split it into CONTINUE records every `splitAt` bytes to test continuation. */
  sst?: boolean;
  splitAt?: number;
  /** Mark the workbook as password-protected (FILEPASS record). */
  encrypted?: boolean;
  /** BOF version (0x0600 = BIFF8). */
  version?: number;
}

const rec = (type: number, data: Buffer): Buffer => {
  const h = Buffer.alloc(4);
  h.writeUInt16LE(type, 0);
  h.writeUInt16LE(data.length, 2);
  return Buffer.concat([h, data]);
};
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
const wide = (s: string) => [...s].some((ch) => ch.charCodeAt(0) > 0xff);
const chars = (s: string) => (wide(s) ? Buffer.from(s, "utf16le") : Buffer.from(s, "latin1"));
const xlString = (s: string, lenBytes: 1 | 2) => Buffer.concat([lenBytes === 1 ? Buffer.from([s.length]) : u16(s.length), Buffer.from([wide(s) ? 1 : 0]), chars(s)]);
const bof = (dt: number, version: number) => rec(0x0809, Buffer.concat([u16(version), u16(dt), Buffer.alloc(12)]));
const cellHead = (r: number, c: number) => Buffer.concat([u16(r), u16(c), u16(0x0f)]);
const f64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(n);
  return b;
};

function workbookStream(sheets: TestSheet[], o: WriteOptions): Buffer {
  const version = o.version ?? 0x0600;
  const strings: string[] = [];
  const indexOf = (s: string) => {
    let i = strings.indexOf(s);
    if (i < 0) i = strings.push(s) - 1;
    return i;
  };
  const sheetStreams = sheets.map((sh) => {
    const parts: Buffer[] = [bof(0x0010, version)];
    sh.rows.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v === null) return;
        if (typeof v === "string") parts.push(o.sst ? rec(0x00fd, Buffer.concat([cellHead(r, c), u32(indexOf(v))])) : rec(0x0204, Buffer.concat([cellHead(r, c), xlString(v, 2)])));
        else if (typeof v === "number") parts.push(rec(0x0203, Buffer.concat([cellHead(r, c), f64(v)])));
        else if (typeof v === "boolean") parts.push(rec(0x0205, Buffer.concat([cellHead(r, c), Buffer.from([v ? 1 : 0, 0])])));
        else if ("rk" in v) parts.push(rec(0x027e, Buffer.concat([cellHead(r, c), u32(((v.rk << 2) | 2) >>> 0)])));
        else if (typeof v.formula === "number") parts.push(rec(0x0006, Buffer.concat([cellHead(r, c), f64(v.formula), u16(0), u32(0), Buffer.from([0x1e, 0x01, 0x00])])));
        else {
          const res = Buffer.from([0, 0, 0, 0, 0, 0, 0xff, 0xff]);
          parts.push(rec(0x0006, Buffer.concat([cellHead(r, c), res, u16(0), u32(0), Buffer.from([0x1e, 0x01, 0x00])])), rec(0x0207, xlString(v.formula, 2)));
        }
      }),
    );
    parts.push(rec(0x000a, Buffer.alloc(0)));
    return Buffer.concat(parts);
  });
  // Sixteen plain cell formats (XF records), as every Excel file has; the cells name format 15. The reader ignores them; other readers need them.
  const globalsHead: Buffer[] = [bof(0x0005, version), ...Array.from({ length: 16 }, () => rec(0x00e0, Buffer.alloc(20)))];
  if (o.encrypted) globalsHead.push(rec(0x002f, Buffer.alloc(6)));
  if (o.sst) {
    const body = Buffer.concat([u32(strings.length), u32(strings.length), ...strings.map((s) => xlString(s, 2))]);
    const split = o.splitAt ?? 8000;
    // A CONTINUE that starts inside a string's characters begins with that string's compression flag (as Excel writes it).
    let start = 0;
    let first = true;
    const pieces: Buffer[] = [];
    // Walk the strings to know where character runs are, so a split inside characters can insert the flag byte.
    const marks: Array<{ from: number; to: number; flag: number }> = [];
    let p = 8;
    for (const s of strings) {
      const f = wide(s) ? 1 : 0;
      p += 3;
      const len = chars(s).length;
      marks.push({ from: p, to: p + len, flag: f });
      p += len;
    }
    while (start < body.length) {
      // Splits fall inside a string's characters only (as Excel writes them; a header or a string boundary is never split), at or after `split` bytes.
      let end = body.length;
      for (const m of marks) {
        const step = m.flag === 1 ? 2 : 1;
        let at = Math.max(start + split, m.from + step);
        if (m.flag === 1 && (at - m.from) % 2 === 1) at += 1;
        if (at < m.to) {
          end = at;
          break;
        }
      }
      const chunk = body.subarray(start, end);
      const cont = marks.find((m) => start >= m.from && start < m.to);
      pieces.push(first ? rec(0x00fc, chunk) : rec(0x003c, cont ? Buffer.concat([Buffer.from([cont.flag]), chunk]) : chunk));
      first = false;
      start = end;
    }
    globalsHead.push(...pieces);
  }
  const boundLen = (name: string) => 4 + 6 + 2 + chars(name).length;
  const globalsLen = globalsHead.reduce((n, b) => n + b.length, 0) + sheets.reduce((n, s) => n + boundLen(s.name), 0) + 4;
  let offset = globalsLen;
  const bounds = sheets.map((s, i) => {
    const b = rec(0x0085, Buffer.concat([u32(offset), Buffer.from([0, 0]), xlString(s.name, 1)]));
    offset += sheetStreams[i]!.length;
    return b;
  });
  return Buffer.concat([...globalsHead, ...bounds, rec(0x000a, Buffer.alloc(0)), ...sheetStreams]);
}

/** A compound file holding one stream; the stream is padded past 4096 bytes so it lives in ordinary sectors. */
export function compoundFile(streamName: string, stream: Buffer): Buffer {
  const S = 512;
  const data = stream.length < 4096 ? Buffer.concat([stream, Buffer.alloc(4096 - stream.length)]) : stream;
  const W = Math.ceil(data.length / S);
  let F = 1;
  while (F * 128 < W + 1 + F) F++;
  const total = W + 1 + F;
  const fat = Buffer.alloc(F * S, 0xff);
  for (let i = 0; i < W; i++) fat.writeUInt32LE(i === W - 1 ? 0xfffffffe : i + 1, i * 4);
  fat.writeUInt32LE(0xfffffffe, W * 4);
  for (let i = 0; i < F; i++) fat.writeUInt32LE(0xfffffffd, (W + 1 + i) * 4);
  void total;
  const header = Buffer.alloc(S);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x3e, 0x18);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(F, 0x2c);
  header.writeUInt32LE(W, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(0xfffffffe, 0x3c);
  header.writeUInt32LE(0xfffffffe, 0x44);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i < F ? W + 1 + i : 0xffffffff, 0x4c + i * 4);
  const dir = Buffer.alloc(S);
  const entry = (i: number, name: string, type: number, start: number, size: number, child: number) => {
    const o = i * 128;
    Buffer.from(name, "utf16le").copy(dir, o);
    dir.writeUInt16LE((name.length + 1) * 2, o + 0x40);
    dir.writeUInt8(type, o + 0x42);
    dir.writeUInt32LE(0xffffffff, o + 0x44);
    dir.writeUInt32LE(0xffffffff, o + 0x48);
    dir.writeUInt32LE(child, o + 0x4c);
    dir.writeUInt32LE(start, o + 0x74);
    dir.writeUInt32LE(size, o + 0x78);
  };
  entry(0, "Root Entry", 5, 0xfffffffe, 0, 1);
  entry(1, streamName, 2, 0, data.length, 0xffffffff);
  const body = Buffer.alloc(W * S);
  data.copy(body);
  return Buffer.concat([header, body, dir, fat]);
}

export function writeXls(sheets: TestSheet[], o: WriteOptions = {}): Buffer {
  return compoundFile("Workbook", workbookStream(sheets, o));
}
