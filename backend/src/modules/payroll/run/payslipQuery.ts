import { z } from "zod";
import { writeAuditLog } from "../../../lib/audit";
import { activeDirectors } from "../../../lib/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { raiseTicket, type HelpdeskViewer } from "../../helpdesk/service";

// "Raise a query" on a payslip (docs/plans/STAGE_5B_PLAN.md, B5). It opens a ticket in the Payroll & Salary category, which is the directors' alone (HR, managers and the Developer role
// never see its tickets or counts: helpdesk/service.ts), and hands it to a director. The ticket names the month, never a figure; the person's own words are the body.

const PAYROLL_CATEGORY = "PAYROLL_SALARY";
export const querySchema = z.object({ message: z.string().trim().min(3, "Say what you would like to ask").max(1000) }).strict();

export async function raisePayslipQuery(viewer: HelpdeskViewer, payslipId: string, raw: unknown, ip: string | null) {
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const slip = await prisma.payslip.findFirst({ where: { id: payslipId, employeeId: viewer.employeeId }, select: { id: true, cycleLabel: true } });
  if (!slip) throw new HttpError(404, "There is no such payslip.", "NOT_FOUND"); // somebody else's payslip does not exist for you
  const category = await prisma.helpdeskCategory.findUnique({ where: { code: PAYROLL_CATEGORY } });
  if (!category || !category.isActive || !category.directorsOnly) throw new HttpError(409, "Payslip queries are not set up: the Payroll category is missing, inactive or not limited to directors.", "NOT_AVAILABLE");
  const ticket = await raiseTicket(viewer, { categoryId: category.id, subject: `Payslip query: ${slip.cycleLabel}`, body: parsed.data.message }, [], { actorUserId: viewer.userId, ipAddress: ip });
  const directors = (await activeDirectors()).filter((d) => d.employeeId !== viewer.employeeId);
  const current = await prisma.helpdeskTicket.findUniqueOrThrow({ where: { id: ticket.id }, select: { assigneeEmployeeId: true } });
  if (!directors.some((d) => d.employeeId === current.assigneeEmployeeId) && directors[0]) await prisma.helpdeskTicket.update({ where: { id: ticket.id }, data: { assigneeEmployeeId: directors[0].employeeId } });
  await writeAuditLog({ actorUserId: viewer.userId, action: "payroll.payslip.query_raised", entityType: "Payslip", entityId: slip.id, after: { ticketId: ticket.id }, ipAddress: ip });
  return { ticketId: ticket.id, number: ticket.number };
}
