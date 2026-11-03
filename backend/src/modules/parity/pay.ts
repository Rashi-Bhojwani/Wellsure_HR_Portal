import { writeAuditLog } from "../../lib/audit";
import { findScopedEmployee } from "../employee/service";
import { getEmployeeSalary } from "../payroll/salary/employees";
import type { ParityMeta, ParityViewer } from "./types";

// A-9 G1 (item 6): the profile's Pay tab. The route needs payroll.salary.view, which HR can never hold (HR_FORBIDDEN_KEYS); directors read everything, but each
// opening writes an audit row (who, whose, when — no figures). The figures are the Payroll module's own (getEmployeeSalary), never recomputed here.
export async function openPay(employeeId: string, viewer: ParityViewer, meta: ParityMeta) {
  await findScopedEmployee(employeeId, viewer.employeeId, viewer.dataScope);
  const salary = await getEmployeeSalary(employeeId);
  await writeAuditLog({ ...meta, action: "employee.pay.opened", entityType: "Employee", entityId: employeeId, after: { opened: "pay-tab", amounts: "redacted" } });
  return salary;
}
