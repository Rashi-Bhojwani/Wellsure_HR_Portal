import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { writeAuditLogs } from "../../lib/audit";
import { decryptField } from "../../lib/encryption";
import { logger } from "../../lib/logger";
import { HttpError } from "../../middleware/errorHandler";
import { createEmployeeInTx } from "../employee/service";
import { createEmployeeSchema } from "../employee/validators";
import { assertReportingLine } from "../managers/hierarchy";
import { reResolveUnmapped } from "../biometric/adminService";
import { absent, type Actor, type Meta } from "./access";
import { retained } from "./candidates";
import { required } from "./settings";
import { requireOnboarding } from "./offerAccess";

// C-4B conversion: an accepted candidate becomes an employee through the existing employee creation service
// (createEmployeeInTx, unchanged) and the existing employee-code practice (HR enters the code; the Add Employee checks apply).
// One click, idempotent and race-safe: the offer row is locked, the conversion row is unique on candidate, offer, application
// and employee, and a retry/double click/simultaneous request returns the same employee. Only non-pay data is copied: the
// candidate's name and the offer's role, department, location, manager, type and joining date. Offer compensation and expected
// pay are never read here. Bank and identity details are entered afterwards by HR through the existing (masked, audited) writers.

const personal = z.object({
  dateOfBirth: z.iso.date(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  personalEmail: z.string().trim().max(320),
  mobile: z.string().trim().max(20),
  currentAddress: z.string().trim().max(300),
  permanentAddress: z.string().trim().max(300),
  emergencyContactName: z.string().trim().max(150),
  emergencyContactPhone: z.string().trim().max(20),
  emergencyContactRelation: z.string().trim().max(50),
  bloodGroup: z.string().trim().max(5).nullable().optional(),
}).strict();
export const convertInput = z.object({
  employeeCode: z.string().trim().min(1).max(30),
  designationId: z.string().min(1).max(100),
  attendanceCapture: z.enum(["DEVICE", "MANUAL"]),
  deviceUserId: z.string().trim().max(30).optional(),
  officialEmail: z.string().trim().max(320).nullable().optional(),
  gradeId: z.string().min(1).max(100).nullable().optional(),
  costCentreId: z.string().min(1).max(100).nullable().optional(),
  personal,
}).strict();

export async function conversionPrefill(offerId: string, actor: Actor) {
  await requireOnboarding(actor);
  const offer = await prisma.recruitmentOffer.findFirst({ where: { id: offerId, state: "ACCEPTED" }, include: { candidate: true, conversion: true } });
  if (!offer || !retained(offer.candidate)) throw absent();
  // Contact details already given by the candidate, to save HR retyping them. Nothing pay-related.
  return {
    offerId, convertedEmployeeId: offer.conversion?.employeeId ?? null,
    fullName: offer.candidate.nameEncrypted ? decryptField(offer.candidate.nameEncrypted) : "",
    email: offer.candidate.emailEncrypted ? decryptField(offer.candidate.emailEncrypted) : null,
    phone: offer.candidate.phoneEncrypted ? decryptField(offer.candidate.phoneEncrypted) : null,
  };
}

async function existing(offerId: string) {
  const row = await prisma.recruitmentConversion.findUnique({ where: { offerId } });
  if (!row) return null;
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: row.employeeId }, select: { id: true, employeeCode: true } });
  return { employeeId: employee.id, employeeCode: employee.employeeCode, created: false };
}

async function joiningComplete(candidateId: string) {
  const types = await required("joinerDocumentTypes");
  const [docs, exceptions] = await Promise.all([
    prisma.recruitmentJoinerDocument.findMany({ where: { candidateId, storageKey: { not: null } }, select: { typeCode: true } }),
    prisma.recruitmentJoiningException.findMany({ where: { candidateId }, select: { typeCode: true } }),
  ]);
  const missing = types.filter(t => !docs.some(d => d.typeCode === t.code) && !exceptions.some(e => e.typeCode === t.code));
  if (missing.length) throw new HttpError(409, `Joining documents still missing: ${missing.map(m => m.label).join(", ")}.`, "JOINING_INCOMPLETE");
}

export async function convert(offerId: string, actor: Actor, body: z.infer<typeof convertInput>, meta: Meta) {
  const c = await requireOnboarding(actor);
  const done = await existing(offerId);
  if (done) return done;
  const offer = await prisma.recruitmentOffer.findFirst({ where: { id: offerId, state: "ACCEPTED" }, include: { candidate: true } });
  if (!offer || !retained(offer.candidate) || !offer.candidate.nameEncrypted) throw absent();
  await joiningComplete(offer.candidateId);
  const parsed = createEmployeeSchema.safeParse({
    official: {
      attendanceCapture: body.attendanceCapture, deviceUserId: body.deviceUserId, employeeCode: body.employeeCode,
      dateOfJoining: offer.joiningDate.toISOString().slice(0, 10), departmentId: offer.departmentId, designationId: body.designationId,
      locationId: offer.locationId, gradeId: body.gradeId ?? null, costCentreId: body.costCentreId ?? null,
      reportingManagerId: offer.reportingManagerId, employmentType: offer.employmentType, officialEmail: body.officialEmail ?? null,
    },
    personal: { ...body.personal, fullName: decryptField(offer.candidate.nameEncrypted) },
  });
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map(i => i.message).join(" "), "VALIDATION_ERROR");
  const input = parsed.data;
  await assertReportingLine({ code: input.official.employeeCode, roleCodes: ["EMPLOYEE"] }, input.official.reportingManagerId ?? null);
  let created: { employeeId: string; employeeCode: string } | null = null;
  try {
    created = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM recruitment_offers WHERE id=${offerId} FOR UPDATE`;
      const prior = await tx.recruitmentConversion.findUnique({ where: { offerId } });
      if (prior) return null; // the other request won; return its employee below
      const fresh = await tx.recruitmentOffer.findUniqueOrThrow({ where: { id: offerId } });
      if (fresh.state !== "ACCEPTED") throw new HttpError(409, "Only an accepted offer can be converted.", "CONFLICT");
      if (await tx.employee.findUnique({ where: { employeeCode: input.official.employeeCode } })) throw new HttpError(409, `Employee Code "${input.official.employeeCode}" is already in use.`, "EMPLOYEE_CODE_TAKEN");
      const { employee } = await createEmployeeInTx(tx, input, meta);
      await tx.recruitmentConversion.create({ data: { candidateId: fresh.candidateId, offerId, applicationId: fresh.applicationId, employeeId: employee.id, convertedByUserId: c.userId } });
      await tx.recruitmentApplication.update({ where: { id: fresh.applicationId }, data: { status: "HIRED", version: { increment: 1 }, changedByUserId: c.userId } });
      await tx.recruitmentJoinerLink.updateMany({ where: { candidateId: fresh.candidateId, revokedAt: null, completedAt: null }, data: { revokedAt: new Date(), revokedByUserId: c.userId } });
      await writeAuditLogs([
        { ...meta, action: "employee.created", entityType: "Employee", entityId: employee.id, after: { official: input.official, source: "RECRUITMENT_CONVERSION" } },
        { ...meta, action: "recruitment.candidate.converted", entityType: "RecruitmentOffer", entityId: offerId, after: { candidateId: fresh.candidateId, employeeId: employee.id } },
      ], tx);
      return { employeeId: employee.id, employeeCode: input.official.employeeCode };
    }, { timeout: 30000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await existing(offerId);
      if (again) return again;
      throw new HttpError(409, "A record with these details already exists (employee code, official email or device ID).", "CONFLICT");
    }
    throw error;
  }
  if (!created) return (await existing(offerId))!;
  if (input.official.attendanceCapture === "DEVICE" && input.official.deviceUserId) {
    await reResolveUnmapped(input.official.deviceUserId).catch((err: unknown) => logger.warn({ err, employeeId: created.employeeId }, "Could not attach earlier punches to the converted employee; map them from the Unmapped queue"));
  }
  return { ...created, created: true };
}
