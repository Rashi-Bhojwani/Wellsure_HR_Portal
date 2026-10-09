import ExcelJS from "exceljs";
import { formatMusterInput, parseMusterCell } from "@shared/attendance/muster";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import type { Meta } from "../processService";
import { entryInput, entryKey, latestEntries } from "./entries";
import { applyEdits, getMuster, inputProblem, type CellEdit } from "./muster";
import { inBranches, markableBranches, type Viewer } from "./scope";

// Muster upload (Phase 2 P2-D, docs/plans/PHASE_2.md §5.2 and "P2-D build
// design"): how the marker's times arrive today. A template per branch and
// cycle (IN and OUT columns per day, pre-filled with the current entries so
// it round-trips), upload → preview → commit. Commit writes only cells that
// differ from the current entry: a corrected re-upload supersedes, never
// duplicates. Blank = leave the day as it is; "-" clears it.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HEADER_ROW = 4;
const SHADE = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEDEDED" } };

async function assertBranch(viewer: Viewer, locationId: string) {
  if (!inBranches(await markableBranches(viewer), locationId)) throw new HttpError(404, "Branch not found.", "NOT_FOUND");
  const location = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true, name: true } });
  if (!location) throw new HttpError(404, "Branch not found.", "NOT_FOUND");
  return location;
}

/** The rows a branch's template holds: its manual-capture people in the cycle, with each day's cell. */
async function branchMuster(viewer: Viewer, locationId: string, cycleStart: string | undefined) {
  const m = await getMuster(viewer, { cycleStart, locationId });
  // Only people with a day the viewer may mark in this branch.
  const rows = m.rows.filter((r) => r.cells.some((c) => c.editable || c.capture === "MANUAL"));
  return { ...m, rows };
}

export async function musterTemplate(viewer: Viewer, q: { locationId: string; cycleStart?: string }) {
  const location = await assertBranch(viewer, q.locationId);
  const m = await branchMuster(viewer, q.locationId, q.cycleStart);
  const entries = await latestEntries(
    m.rows.map((r) => r.employeeId),
    m.cycle.start,
    m.cycle.end,
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Muster");
  ws.getCell("A1").value = `Manual attendance muster: ${location.name}, ${m.cycle.label}`;
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value =
    "Type the IN and OUT times (e.g. 10:05 and 19:10), or a letter in the IN column: P, A, P:A, A:P (half day), W (worked an off day). A blank cell leaves the day as it is. Shaded days can't be marked here.";
  ws.getCell("A2").font = { italic: true };
  ws.getCell("A3").value = "To clear a day marked by mistake, type - (a dash) in its IN cell: the day goes back to Not marked. Deleting what's in the cell does NOT clear it.";
  ws.getCell("A3").font = { bold: true, color: { argb: "FFC00000" } };
  const header = ["Employee Code", "Name", ...m.days.flatMap((d) => [`${d.date} ${WEEKDAYS[d.weekday]} IN`, `${d.date} ${WEEKDAYS[d.weekday]} OUT`])];
  ws.getRow(HEADER_ROW).values = header;
  ws.getRow(HEADER_ROW).font = { bold: true };
  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 24;
  for (let i = 3; i <= header.length; i++) ws.getColumn(i).width = 9;
  m.rows.forEach((r, idx) => {
    const row = ws.getRow(HEADER_ROW + 1 + idx);
    row.getCell(1).value = r.employeeCode;
    row.getCell(2).value = r.name;
    r.cells.forEach((c, i) => {
      const inCell = row.getCell(3 + i * 2);
      const outCell = row.getCell(4 + i * 2);
      inCell.numFmt = "@";
      outCell.numFmt = "@";
      const entry = entries.get(entryKey(r.employeeId, c.date));
      const input = entry && entry.kind !== "CLEARED" ? entryInput(entry) : null;
      if (input?.kind === "TIMED") {
        inCell.value = input.inTime;
        outCell.value = input.outTime ?? "";
      } else if (input?.kind === "STATUS_ONLY") {
        inCell.value = formatMusterInput(input);
      }
      if (!c.editable || c.offDayOnly) {
        if (!input && c.code && c.code !== "NM") inCell.value = c.code; // OFF, H, PL … shown for reference
        if (!c.editable) {
          inCell.fill = SHADE;
          outCell.fill = SHADE;
        }
      }
    });
  });
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: HEADER_ROW }];
  const about = wb.addWorksheet("About");
  about.addRows([
    ["locationId", location.id],
    ["cycleStart", m.cycle.start],
    ["Do not edit this sheet: it tells the upload which branch and cycle the file is for."],
  ]);
  about.state = "veryHidden";
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `muster-${location.name.replace(/[^A-Za-z0-9-]+/g, "-")}-${m.cycle.start}.xlsx` };
}

/** A cell's text as typed: Excel may have turned 10:05 into a time value. */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  if (typeof v === "number") {
    if (v >= 0 && v < 1) {
      const minutes = Math.round(v * 1440);
      return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    }
    return String(v);
  }
  if (typeof v === "object" && "richText" in v) return v.richText.map((t) => t.text).join("");
  if (typeof v === "object" && "result" in v) return cellText(v.result as ExcelJS.CellValue);
  return String(v).trim();
}

const TIME_LIKE = /^\d{1,2}[:.]?\d{2}$/;

/** IN and OUT cells → what would have been typed into the grid ("" = no change). */
function combine(inText: string, outText: string, shownCode: string | null): { text: string } | { error: string } {
  const i = inText.trim();
  const o = outText.trim();
  if (!i && !o) return { text: "" };
  if (!i && o) return { error: "An OUT time with no IN time." };
  if (!o && shownCode && i.toUpperCase() === shownCode.toUpperCase()) return { text: "" }; // the reference code we pre-filled
  if (TIME_LIKE.test(i)) return { text: `${i}-${o}` };
  if (o) return { error: `"${i}" in IN with an OUT time: use two times, or a letter alone.` };
  return { text: i };
}

export interface UploadIssue {
  row: number;
  employeeCode: string | null;
  date: string | null;
  issue: string;
}

export async function previewUpload(viewer: Viewer, file: { buffer: Buffer; originalname: string }) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new HttpError(400, "That file isn't a readable .xlsx workbook.", "INVALID_UPLOAD");
  }
  const about = wb.getWorksheet("About");
  const ws = wb.getWorksheet("Muster");
  const meta = new Map<string, string>();
  about?.eachRow((r) => meta.set(cellText(r.getCell(1).value), cellText(r.getCell(2).value)));
  const locationId = meta.get("locationId");
  const cycleStart = meta.get("cycleStart");
  if (!ws || !locationId || !cycleStart) throw new HttpError(400, "Use the template downloaded from the Attendance Muster: this file doesn't say which branch and cycle it's for.", "INVALID_UPLOAD");
  const location = await assertBranch(viewer, locationId);
  const m = await branchMuster(viewer, locationId, cycleStart);
  const byCode = new Map(m.rows.map((r) => [r.employeeCode, r]));
  const entries = await latestEntries(
    m.rows.map((r) => r.employeeId),
    m.cycle.start,
    m.cycle.end,
  );

  // Header: "<date> <Wkd> IN|OUT" columns.
  const columns = new Map<string, { inCol?: number; outCol?: number }>();
  // The header row is the one labelled "Employee Code" (an older template had it one row higher).
  let headerRow = 0;
  for (let r = 1; r <= 10 && !headerRow; r++) if (cellText(ws.getRow(r).getCell(1).value) === "Employee Code") headerRow = r;
  if (!headerRow) throw new HttpError(400, "Use the template downloaded from the Attendance Muster: its header row (Employee Code, Name, then the days) is missing.", "INVALID_UPLOAD");
  ws.getRow(headerRow).eachCell((cell, col) => {
    const match = /^(\d{4}-\d{2}-\d{2})\b.*\b(IN|OUT)$/i.exec(cellText(cell.value));
    if (!match) return;
    const slot = columns.get(match[1]!) ?? {};
    if (match[2]!.toUpperCase() === "IN") slot.inCol = col;
    else slot.outCol = col;
    columns.set(match[1]!, slot);
  });
  const known = new Set(m.days.map((d) => d.date));
  if (columns.size === 0 || [...columns.keys()].some((d) => !known.has(d))) throw new HttpError(400, `The day columns don't match ${m.cycle.label}. Download a fresh template.`, "INVALID_UPLOAD");

  const issues: UploadIssue[] = [];
  const edits: Array<CellEdit & { kind: string; before: string | null }> = [];
  let unchanged = 0;
  let blank = 0;
  const seen = new Set<string>();
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const code = cellText(row.getCell(1).value);
    if (!code) return;
    const target = byCode.get(code);
    if (!target) {
      issues.push({ row: rowNumber, employeeCode: code, date: null, issue: `Not a manual-attendance employee you mark at ${location.name} in this cycle; the row was skipped.` });
      return;
    }
    if (seen.has(code)) {
      issues.push({ row: rowNumber, employeeCode: code, date: null, issue: "This employee appears more than once; only the first row was used." });
      return;
    }
    seen.add(code);
    for (const c of target.cells) {
      const slot = columns.get(c.date);
      if (!slot?.inCol) continue;
      const combined = combine(cellText(row.getCell(slot.inCol).value), slot.outCol ? cellText(row.getCell(slot.outCol).value) : "", c.code);
      if ("error" in combined) {
        issues.push({ row: rowNumber, employeeCode: code, date: c.date, issue: combined.error });
        continue;
      }
      if (!combined.text) {
        blank += 1;
        continue;
      }
      const parsed = parseMusterCell(combined.text);
      if (!parsed.ok || !parsed.value) {
        issues.push({ row: rowNumber, employeeCode: code, date: c.date, issue: parsed.ok ? "Nothing entered." : parsed.error });
        continue;
      }
      if (!c.editable) {
        issues.push({ row: rowNumber, employeeCode: code, date: c.date, issue: `Not marked: ${c.reason ?? "this day can't be marked here."}` });
        continue;
      }
      const problem = inputProblem(parsed.value, { status: c.status }, c.offDayOnly);
      if (problem) {
        issues.push({ row: rowNumber, employeeCode: code, date: c.date, issue: problem });
        continue;
      }
      const before = entries.get(entryKey(target.employeeId, c.date));
      const beforeText = before && before.kind !== "CLEARED" ? formatMusterInput(entryInput(before)) : "";
      const nextText = parsed.value.kind === "CLEARED" ? "" : formatMusterInput(parsed.value);
      if (beforeText === nextText) {
        unchanged += 1;
        continue;
      }
      edits.push({ employeeId: target.employeeId, date: c.date, text: combined.text, kind: parsed.value.kind, before: beforeText || null });
    }
  });

  const counts = {
    timed: edits.filter((e) => e.kind === "TIMED").length,
    statusOnly: edits.filter((e) => e.kind === "STATUS_ONLY").length,
    cleared: edits.filter((e) => e.kind === "CLEARED").length,
    unchanged,
    blank,
    issues: issues.length,
  };
  const upload = await prisma.manualMusterUpload.create({
    data: {
      locationId,
      cycleStart: new Date(`${m.cycle.start}T00:00:00Z`),
      cycleEnd: new Date(`${m.cycle.end}T00:00:00Z`),
      fileName: file.originalname,
      pendingCells: edits.map(({ employeeId, date, text }) => ({ employeeId, date, text })),
      summary: { counts, issues: issues.slice(0, 500) } as never,
      uploadedByUserId: viewer.userId,
    },
  });
  const names = new Map(m.rows.map((r) => [r.employeeId, `${r.employeeCode} ${r.name}`]));
  return {
    uploadId: upload.id,
    branch: location.name,
    cycle: m.cycle,
    fileName: file.originalname,
    counts,
    // before → after, so a clear ("-") shows exactly what it removes
    changes: edits.slice(0, 500).map((e) => ({ employee: names.get(e.employeeId) ?? e.employeeId, date: e.date, before: e.before, entry: e.kind === "CLEARED" ? "-" : e.text, kind: e.kind })),
    issues: issues.slice(0, 500),
  };
}

export async function commitUpload(viewer: Viewer, uploadId: string, meta: Meta) {
  const upload = await prisma.manualMusterUpload.findUnique({ where: { id: uploadId } });
  if (!upload || upload.uploadedByUserId !== viewer.userId) throw new HttpError(404, "Upload not found.", "NOT_FOUND");
  if (upload.status !== "PREVIEW") throw new HttpError(409, "This upload has already been committed.", "ALREADY_COMMITTED");
  await assertBranch(viewer, upload.locationId);
  const edits = (upload.pendingCells ?? []) as unknown as CellEdit[];
  // Claim it first, so a double click can't write twice.
  const claimed = await prisma.manualMusterUpload.updateMany({ where: { id: upload.id, status: "PREVIEW" }, data: { status: "COMMITTED", committedAt: new Date() } });
  if (claimed.count === 0) throw new HttpError(409, "This upload has already been committed.", "ALREADY_COMMITTED");
  if (edits.length === 0) {
    await prisma.manualMusterUpload.update({ where: { id: upload.id }, data: { pendingCells: [] } });
    return { saved: 0, unchanged: 0 };
  }
  try {
    const result = await applyEdits(viewer, edits, { via: "MUSTER_UPLOAD", uploadId: upload.id }, meta);
    await prisma.manualMusterUpload.update({ where: { id: upload.id }, data: { pendingCells: [] } });
    return result;
  } catch (err) {
    // Something changed since the preview (e.g. leave approved): nothing was written; preview again.
    await prisma.manualMusterUpload.update({ where: { id: upload.id }, data: { status: "PREVIEW", committedAt: null } });
    throw err;
  }
}
