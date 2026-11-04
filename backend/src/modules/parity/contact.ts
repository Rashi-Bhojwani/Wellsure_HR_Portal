import { writeAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { findScopedEmployee } from "../employee/service";
import type { ParityMeta, ParityViewer } from "./types";

// A-9 G1 (item 5): another person's mobile and emergency number are shown as the last 4 everywhere (grid, export, profile). The full numbers come only from here:
// the key, the person in the viewer's scope, a reason, and an audit row that records who looked, why and when — never the number itself.
export async function revealContact(employeeId: string, reason: string, viewer: ParityViewer, meta: ParityMeta) {
  await findScopedEmployee(employeeId, viewer.employeeId, viewer.dataScope);
  const personal = await prisma.employeePersonal.findUnique({ where: { employeeId }, select: { mobile: true, emergencyContactPhone: true } });
  if (!personal) throw new HttpError(404, "No contact details on file.", "NOT_FOUND");
  await writeAuditLog({ ...meta, action: "employee.contact.revealed", entityType: "Employee", entityId: employeeId, after: { reason, fields: ["mobile", "emergencyContactPhone"] } });
  return { mobile: personal.mobile, emergencyContactPhone: personal.emergencyContactPhone };
}
