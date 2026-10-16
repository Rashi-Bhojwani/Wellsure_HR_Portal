import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// EF2 guard (docs/plans/EFFECTIVE_DATES.md): "current" means IN FORCE TODAY
// (lib/effectiveDating.ts inForceOn / inForceSql), never "the row with no end
// date" — that row may be a scheduled future change. This fails on any new
// `effectiveTo: null`-style read outside the few places allowed to look at
// the open row itself, the same way the route-inventory guard catches an
// unclassified route: a new query can't quietly bring the bug back.
const SRC = path.resolve(__dirname, "../..");
const PATTERN = /effectiveTo:\s*null|validTo:\s*null|effective_to\s+IS\s+NULL|valid_to\s+IS\s+NULL/i;
const ALLOWED = new Set([
  "lib/effectiveDating.ts", // the model itself (writers, the open-row rules)
  "lib/historyRepair.ts", // finds rows that break the model
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

describe("no 'current = no end date' reads outside lib/effectiveDating.ts", () => {
  it("every read of history goes through inForceOn / inForceSql", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (PATTERN.test(line) && !line.trim().startsWith("//")) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders, "Use inForceOn(day) / inForceSql(alias, day) from lib/effectiveDating.ts").toEqual([]);
  });

  // EF4 (docs/plans/PHASE_6.md "Effective-dating contract"): payroll and
  // attendance answer "what was true on day D" only through the readers in
  // lib/effectiveDating.ts (placementOn, placementSegments, nameOn,
  // bankAccountOn, employeeForDeviceUserOn, employedOn) — never by querying a
  // history table themselves.
  it("payroll and attendance never query history tables directly", () => {
    const HISTORY = /\.(employeeJobHistory|employeeNameHistory|employeeBankAccount|employeeSalary|deviceUserMapping|attendanceAssignment)\.|employee_job_history|employee_name_history|employee_bank_accounts|employee_salaries|device_user_mappings|attendance_assignments/;
    const offenders: string[] = [];
    for (const area of ["modules/payroll", "modules/attendance", "modules/biometric"]) {
      for (const file of walk(path.join(SRC, area))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (HISTORY.test(line) && !line.trim().startsWith("//")) offenders.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`);
          });
      }
    }
    expect(offenders, "Use the readers in lib/effectiveDating.ts").toEqual([]);
  });
});
