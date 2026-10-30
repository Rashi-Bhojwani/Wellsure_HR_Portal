import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

// Stage 4: the muster and attendance finalisation hold no money. Attendance carries days, hours and statuses; every figure of pay lives in payroll. Two ways to break
// that are pinned here: a column of an attendance table that holds money, and attendance code that reaches into a payroll money table.

const ATTENDANCE_MODELS = ["Shift", "ShiftSession", "AttendancePolicy", "AttendanceAssignment", "AttendanceCycleRule", "AttendanceManualBranch", "RawPunch", "DailyAttendance", "AttendanceProcessRun", "ManualAttendanceEntry", "ManualMusterUpload", "RegularizationRequest", "RegularizationBatch", "AttendanceOverride", "ShiftOverride", "AttendancePeriodLock", "LeaveDayRelease"];
const MONEY_WORDS = /salary|ctc|amount|wage|rupee|\binr\b|bank|earning|deduction|incentive|advance|bonus|payout|pay_?(?!load)|price|cost|rate$/i;
const PAYROLL_MONEY = /payrollMonthlyInput|payrollAdjustment|employeeSalary|payrollRunLine|payrollRunItem|payrollSalaryHold|modules\/payroll\/(salary|inputs|run)/;

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : filesUnder(path);
    return path.endsWith(".ts") ? [path] : [];
  });

describe("the muster and attendance finalisation hold no money", () => {
  it("no attendance table has a column that holds money", () => {
    const models = Prisma.dmmf.datamodel.models.filter((m) => ATTENDANCE_MODELS.includes(m.name));
    expect(models.map((m) => m.name).sort()).toEqual([...ATTENDANCE_MODELS].sort()); // the list above is the real list (a renamed table fails here, not silently)
    const offenders = models.flatMap((m) => m.fields.filter((f) => f.kind === "scalar" && ["Decimal", "Float", "Int", "BigInt"].includes(f.type) && MONEY_WORDS.test(f.name)).map((f) => `${m.name}.${f.name}`));
    expect(offenders, "A column that holds money does not belong in attendance. Pay lives in payroll.").toEqual([]);
  });

  it("attendance code never reads or writes a payroll money table", () => {
    const offenders = filesUnder(join(__dirname, "..")).flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, i) => (PAYROLL_MONEY.test(line) && !line.trim().startsWith("//") ? [`${file.split("modules/")[1]}:${i + 1}: ${line.trim()}`] : [])));
    expect(offenders).toEqual([]);
  });
});
