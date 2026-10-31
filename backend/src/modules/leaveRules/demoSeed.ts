import { prisma } from "../../lib/prisma";
import { resolveAccess } from "../../lib/permissions";
import { addCalendarDays, businessToday } from "../../lib/businessDate";
import { applyForLeave, approveLeaveRequest } from "../leave/requests";
import { attachDocument } from "./documents";
import { approveRules, prepareRules } from "./service";

// The demo company's new leave types (development only; scripts/demo/seedDemoCompany.ts). Made-up rules labelled DEMO, through the real services:
// the demo HR Admin (DEMO004) prepares medical leave rules and a demo director (DEMO001) approves them; DEMO006 applies for medical leave with a reason
// carrying a marker the sensitive-data scan looks for on everyone else's screens, attaches a made-up document, and the director approves it.

type Who = Record<string, { employeeId: string; userId: string }>;
export const DEMO_LEAVE_REASON_MARKER = "DEMO-LEAVE-REASON-PRIVATE";
const DEMO_PDF = Buffer.from("%PDF-1.4\n% DEMO COMPANY: a made-up supporting document\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

export async function seedDemoLeaveTypes(who: Who): Promise<void> {
  if ((await prisma.leaveRuleVersion.count()) > 0) return;
  const meta = (code: string) => ({ actorUserId: who[code]!.userId, ipAddress: null, userAgent: null });
  const rules = { paid: true, entitlement: { kind: "CAP", period: "PER_CALENDAR_YEAR", days: "6" }, eligibility: { minServiceDays: 0, employmentTypes: ["PERMANENT", "CONTRACT", "PROBATION"] }, units: "FULL_DAY", counting: "WORKING_DAYS", document: { required: true, whenMoreThanDays: 0 }, approvalRoute: "HR_ONLY", yearEnd: null };
  const v = await prepareRules("MEDICAL", { rules, note: "DEMO COMPANY: made-up rules" }, { userId: who.DEMO004!.userId, isDirector: false, canPrepare: true }, meta("DEMO004"));
  await approveRules("MEDICAL", v.version, { effectiveFrom: businessToday().toISOString().slice(0, 10), note: "DEMO COMPANY" }, { userId: who.DEMO001!.userId, isDirector: true, canPrepare: true }, meta("DEMO001"));

  const viewer = async (code: string) => {
    const access = await resolveAccess(who[code]!.userId);
    return { employeeId: who[code]!.employeeId, roleCodes: access.roleCodes, dataScope: access.dataScope, permissions: access.permissions };
  };
  const medical = await prisma.leaveType.findUniqueOrThrow({ where: { code: "MEDICAL" } });
  let monday = addCalendarDays(businessToday(), 7);
  while (monday.getUTCDay() !== 1) monday = addCalendarDays(monday, 1);
  const day = monday.toISOString().slice(0, 10);
  const request = await applyForLeave({ leaveTypeId: medical.id, fromDate: day, toDate: day, fromDayPart: "FULL", toDayPart: "FULL", reason: `${DEMO_LEAVE_REASON_MARKER}: a made-up reason` } as never, await viewer("DEMO006"), meta("DEMO006"));
  await attachDocument(request.id, { buffer: DEMO_PDF, mimetype: "application/pdf", originalname: "demo.pdf", size: DEMO_PDF.length } as Express.Multer.File, { userId: who.DEMO006!.userId, employeeId: who.DEMO006!.employeeId, canOpen: false }, meta("DEMO006"));
  await approveLeaveRequest(request.id, await viewer("DEMO001"), "DEMO COMPANY", meta("DEMO001"));
}
