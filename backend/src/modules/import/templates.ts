import ExcelJS from "exceljs";
import { DATASET_COLUMNS, type ImportDatasetKey } from "./types";

const NOTES: Record<ImportDatasetKey, string[]> = {
  "org-masters": [
    "type: one of LOCATION, DEPARTMENT, DESIGNATION, GRADE, COST_CENTRE — one row per master, mixed freely in one file.",
    "code and name are required for every row.",
    "LOCATION rows also need cityName (must match an existing city), addressLine1, city, state, pincode.",
    "GRADE rows may optionally set rank (a number used for display order).",
  ],
  employees: [
    "attendanceCapture: DEVICE (the default if blank) or MANUAL. MANUAL is a deliberate choice for someone at a branch with no biometric machine: their attendance is marked manually by whoever marks that branch, and deviceUserId must be blank.",
    "deviceUserId is the raw biometric machine ID (required for DEVICE). Leave employeeCode blank to reuse it as the Employee Code, unless it collides with one already on record. MANUAL rows must fill employeeCode.",
    "departmentCode / designationCode / locationCode / gradeCode / costCentreCode must match an existing code in Organisation Setup.",
    "reportingManagerCode, if set, must match an existing employeeCode.",
    "personalEmail must be a gmail.com address (same rule as the Add Employee wizard).",
    "Dates are YYYY-MM-DD.",
    "Ex-employees (migrating from greytHR): fill lastWorkingDate (on or after dateOfJoining, not in the future) and, if known, exitReason. They are imported as separated — no login, never invited, their device ID free for reuse from the day after — with no separation workflow needed. reportingManagerCode, if set, may be anyone on record (their old manager may have left too). Leave both blank for current employees.",
  ],
  statutory: [
    "employeeCode must match an employee already on record (import the Employees dataset first).",
    "pan and aadhaar are optional but validated when present; leave blank to skip a field for that employee.",
  ],
  bank: [
    "employeeCode must match an employee already on record (import the Employees dataset first).",
    "All columns are required. Committing this dataset requires the bank-details permission and a typed confirmation.",
  ],
  "leave-grants": [
    "employeeCode must match an employee already on record.",
    "leaveTypeCode must be an active leave type's code (PL, LOP, WFH, RH) — COF is not supported here, use Leave Granter's Comp-Off Grant action instead (it needs hours worked, not just a day count).",
    "days is signed: a positive number credits the balance, a negative number debits it. Never zero. Half-days are allowed, e.g. 0.5 or -0.5.",
    "entryDate is YYYY-MM-DD — the ledger date this grant/debit is recorded against.",
    "remarks is optional free text, shown on the ledger entry.",
  ],
};

// Blank downloadable template (spec §10) — header row only, plus a second
// "Instructions" sheet. No example data row: a stray example row left in by
// mistake and re-uploaded would otherwise become a real, wrong record.
export async function buildTemplate(dataset: ImportDatasetKey): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  sheet.columns = DATASET_COLUMNS[dataset].map((header) => ({ header, key: header, width: 22 }));
  sheet.getRow(1).font = { bold: true };

  const notes = workbook.addWorksheet("Instructions");
  notes.columns = [{ header: "Notes", key: "note", width: 100 }];
  notes.getRow(1).font = { bold: true };
  for (const note of NOTES[dataset]) {
    notes.addRow({ note });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
