import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import type { RequestMetaInput } from "./types";

// SS-15 (M session): "Download my data" (spec §9, India DPDP Act 2023: export of an employee's own data). Only ever the caller's own record, resolved
// from the sign-in, never from a client-supplied id. Identifiers stay masked to their last four digits (the full numbers are on the person's own
// documents and are not needed to know what the company holds); payslips are listed by month, their content is under Salary → Payslips. Audited.

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function exportMyData(employeeId: string, meta: RequestMetaInput) {
  const e = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      personal: true,
      nameHistory: { orderBy: { effectiveFrom: "asc" } },
      jobHistory: { orderBy: { effectiveFrom: "asc" }, include: { department: true, designation: true, location: true, grade: true, costCentre: true } },
      bankAccounts: { orderBy: { effectiveFrom: "asc" } },
      statutory: true,
    },
  });
  if (!e) throw new HttpError(404, "Employee not found.", "NOT_FOUND");

  const [leaveRequests, leaveLedger, attendance, regularizations, documents, tickets, kudosReceived, kudosGiven, posts, payslips] = await Promise.all([
    prisma.leaveRequest.findMany({ where: { employeeId }, include: { leaveType: true }, orderBy: { createdAt: "asc" } }),
    prisma.leaveLedger.findMany({ where: { employeeId }, include: { leaveType: true }, orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }] }),
    prisma.dailyAttendance.findMany({ where: { employeeId }, orderBy: { date: "asc" } }),
    prisma.regularizationRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "asc" } }),
    prisma.employeeDocument.findMany({ where: { employeeId, visibleToEmployee: true, archivedAt: null }, include: { category: true }, orderBy: { uploadedAt: "asc" } }),
    prisma.helpdeskTicket.findMany({ where: { raisedByEmployeeId: employeeId }, include: { category: true }, orderBy: { createdAt: "asc" } }),
    prisma.kudos.findMany({ where: { toEmployeeId: employeeId }, orderBy: { createdAt: "asc" } }),
    prisma.kudos.findMany({ where: { fromEmployeeId: employeeId }, orderBy: { createdAt: "asc" } }),
    prisma.post.findMany({ where: { authorEmployeeId: employeeId, moderatedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.payslip.findMany({ where: { employeeId }, select: { cycleLabel: true, cycleStart: true, publishedAt: true }, orderBy: { cycleStart: "asc" } }),
  ]);

  const p = e.personal;
  const out = {
    about: "Your own data held by the HR portal, as of the time below. Identity numbers are shown by their last four digits only. Payslips are listed by month; open them under Salary → Payslips.",
    generatedAt: new Date().toISOString(),
    employee: { employeeCode: e.employeeCode, status: e.status, employmentType: e.employmentType, dateOfJoining: day(e.dateOfJoining), lastWorkingDate: day(e.lastWorkingDate) },
    personal: p
      ? {
          dateOfBirth: day(p.dateOfBirth),
          gender: p.gender,
          personalEmail: p.personalEmail,
          mobile: p.mobile,
          currentAddress: p.currentAddress,
          permanentAddress: p.permanentAddress,
          emergencyContact: { name: p.emergencyContactName, phone: p.emergencyContactPhone, relation: p.emergencyContactRelation },
          bloodGroup: p.bloodGroup,
          hasPhoto: !!p.photoStorageKey,
        }
      : null,
    names: e.nameHistory.map((n) => ({ fullName: n.fullName, from: day(n.effectiveFrom), to: day(n.effectiveTo) })),
    jobs: e.jobHistory.map((j) => ({
      from: day(j.effectiveFrom),
      to: day(j.effectiveTo),
      department: j.department?.name ?? null,
      designation: j.designation?.name ?? null,
      location: j.location?.name ?? null,
      grade: j.grade?.name ?? null,
      costCentre: j.costCentre?.name ?? null,
      reason: j.changeReason,
    })),
    bankAccounts: e.bankAccounts.map((b) => ({ accountHolderName: b.accountHolderName, accountNumberLast4: b.accountNumberLast4, ifsc: b.ifsc, bankName: b.bankName, branchName: b.branchName, from: day(b.effectiveFrom), to: day(b.effectiveTo) })),
    statutory: e.statutory ? { panLast4: e.statutory.panLast4, aadhaarLast4: e.statutory.aadhaarLast4, uanLast4: e.statutory.uanLast4, esiLast4: e.statutory.esiLast4 } : null,
    leaveRequests: leaveRequests.map((r) => ({ type: r.leaveType.name, from: day(r.fromDate), to: day(r.toDate), days: r.totalDays.toString(), reason: r.reason, status: r.status, appliedAt: iso(r.createdAt), decidedAt: iso(r.decidedAt), decisionComments: r.decisionComments })),
    leaveLedger: leaveLedger.map((l) => ({ type: l.leaveType.name, date: day(l.entryDate), entry: l.entryType, days: l.days.toString(), remarks: l.remarks })),
    attendance: attendance.map((a) => ({ date: day(a.date), status: a.status, shift: a.shiftCode, firstIn: iso(a.firstIn), lastOut: iso(a.lastOut), lateInMinutes: a.lateInMinutes, earlyOutMinutes: a.earlyOutMinutes, lopDays: a.lopDays?.toString() ?? null, source: a.source })),
    attendanceCorrections: regularizations.map((r) => ({ date: day(r.date), reason: r.reasonCode, note: r.reason, status: r.status, askedAt: iso(r.createdAt), decidedAt: iso(r.decidedAt), decisionNote: r.decisionNote })),
    documents: documents.map((d) => ({ title: d.title, category: d.category.name, fileName: d.fileName, uploadedAt: iso(d.uploadedAt) })),
    helpdeskTickets: tickets.map((t) => ({ subject: t.subject, category: t.category.name, status: t.status, raisedAt: iso(t.createdAt), resolvedAt: iso(t.resolvedAt), closedAt: iso(t.closedAt) })),
    kudosReceived: kudosReceived.map((k) => ({ message: k.message, at: iso(k.createdAt) })),
    kudosGiven: kudosGiven.map((k) => ({ message: k.message, at: iso(k.createdAt) })),
    posts: posts.map((x) => ({ kind: x.kind, body: x.body, at: iso(x.createdAt) })),
    payslips: payslips.map((s) => ({ month: s.cycleLabel, publishedAt: iso(s.publishedAt) })),
  };
  await writeAuditLog({ ...meta, action: "employee.self_export.downloaded", entityType: "Employee", entityId: employeeId, after: { sections: Object.keys(out).length } });
  return out;
}
