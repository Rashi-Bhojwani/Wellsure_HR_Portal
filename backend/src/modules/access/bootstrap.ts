import { z } from "zod";
import { writeAuditLog } from "../../lib/audit";
import { ensureAccessCatalog } from "../../lib/accessCatalog";
import { SUPER_ADMIN_ROLE_CODE } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { createInvitation, resendInvitation } from "../auth/service";
import { gmailSchema, MOBILE_REGEX } from "../employee/validators";

// One-time creation of the first real SUPER_ADMIN on a fresh staging or
// production database (Phase 5 commit E1). Run by scripts/admin-bootstrap.ts
// — see docs/GETTING_STARTED.md "Creating the first Super Admin".
//
// Staging and production are never seeded, so the only way in is this:
// refuses outright once any active SUPER_ADMIN exists (from then on Super
// Admins are appointed in the app, by a Super Admin). The person's details
// are supplied at runtime and never live in the repo. No password ever
// passes through it: the person gets the normal invitation email and sets
// their own password (and 2FA, where required) in the browser.

const PLACEHOLDER = "To be updated in the portal";

export const bootstrapInputSchema = z.object({
  employeeCode: z.string().trim().min(1).max(30),
  // Only needed when the employee doesn't exist yet.
  fullName: z.string().trim().min(1).max(150).optional(),
  personalEmail: gmailSchema.optional(),
  mobile: z.string().trim().regex(MOBILE_REGEX, "Enter a valid mobile number.").optional(),
  dateOfBirth: z.iso.date().optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  dateOfJoining: z.iso.date().optional(),
  officialEmail: z.string().trim().toLowerCase().email().optional(),
});
export type BootstrapInput = z.input<typeof bootstrapInputSchema>;

export const NEW_EMPLOYEE_FIELDS = ["fullName", "personalEmail", "mobile", "dateOfBirth", "gender", "dateOfJoining"] as const;

// A refusal the CLIs print as-is (no stack trace) and exit 1 on.
export class AdminCliRefusal extends Error {}

export interface BootstrapResult {
  outcome: "created" | "attached" | "reinvited";
  employeeId: string;
  userId: string;
  employeeCode: string;
  // "invited": an invitation email went out (link valid per the
  // auth.invitationTtlHours setting); "active": the person already had an
  // account and simply signs in again.
  account: "invited" | "active";
  invitedEmail: string | null;
  link: string | null;
}

async function superAdminHolders() {
  return prisma.userRole.findMany({
    where: { role: { code: SUPER_ADMIN_ROLE_CODE } },
    select: { user: { select: { id: true, status: true, employee: { select: { employeeCode: true } } } } },
  });
}

// Throws AdminCliRefusal unless a bootstrap may run for this employee code:
// no active Super Admin, and no outstanding Super Admin invitation for
// someone else. The CLI calls it before asking for any details.
export async function assertBootstrapAllowed(employeeCode: string): Promise<void> {
  const holders = await superAdminHolders();
  if (holders.some((h) => h.user.status === "ACTIVE")) {
    throw new AdminCliRefusal(
      "An active Super Admin already exists. Super Admins are appointed in the app from now on (Employee profile → Access). If every Super Admin is locked out, use the recovery procedure (npm run admin:recover) instead.",
    );
  }
  const pending = holders.filter((h) => h.user.status === "INVITED");
  if (pending.length > 0 && !pending.some((h) => h.user.employee.employeeCode === employeeCode.trim())) {
    throw new AdminCliRefusal(
      `A Super Admin invitation is already outstanding for employee ${pending.map((h) => h.user.employee.employeeCode).join(", ")}. Re-run with that employee code to send a fresh link; nobody else can be bootstrapped until they've activated.`,
    );
  }
}

export async function bootstrapSuperAdmin(rawInput: BootstrapInput): Promise<BootstrapResult> {
  const input = bootstrapInputSchema.parse(rawInput);
  await ensureAccessCatalog();
  await assertBootstrapAllowed(input.employeeCode);
  return provisionSuperAdmin(input);
}

// The provisioning itself, with no "is there already a Super Admin?" check.
// Exported only so the tests can exercise it against the seeded database
// (which always has active Super Admins); bootstrapSuperAdmin above is the
// only production caller.
export async function provisionSuperAdmin(rawInput: BootstrapInput): Promise<BootstrapResult> {
  const input = bootstrapInputSchema.parse(rawInput);
  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { code: SUPER_ADMIN_ROLE_CODE } });
  const employeeRole = await prisma.role.findUnique({ where: { code: "EMPLOYEE" } });

  const existing = await prisma.employee.findUnique({
    where: { employeeCode: input.employeeCode },
    include: { user: true, personal: true, nameHistory: { where: { effectiveTo: null } } },
  });

  if (existing) {
    if (!existing.user) throw new AdminCliRefusal(`Employee ${input.employeeCode} has no user account.`);
    if (existing.status !== "ACTIVE" || (existing.user.status !== "ACTIVE" && existing.user.status !== "INVITED")) {
      throw new AdminCliRefusal(`Employee ${input.employeeCode} is not active (employee ${existing.status}, account ${existing.user.status}) and can't become a Super Admin.`);
    }
    const userId = existing.user.id;
    const alreadyHeld = await prisma.userRole.findUnique({ where: { userId_roleId: { userId, roleId: superAdminRole.id } } });
    if (!alreadyHeld) await prisma.userRole.create({ data: { userId, roleId: superAdminRole.id, assignedByUserId: null } });

    let link: string | null = null;
    const email = existing.personal?.personalEmail ?? null;
    if (existing.user.status === "INVITED") {
      if (!email) throw new AdminCliRefusal(`Employee ${input.employeeCode} has no personal email to send the invitation to.`);
      ({ link } = await resendInvitation(userId, email, existing.nameHistory[0]?.fullName ?? existing.employeeCode, existing.employeeCode));
    }
    const outcome = alreadyHeld ? "reinvited" : "attached";
    await writeAuditLog({
      actorUserId: null,
      action: "access.super_admin.bootstrapped",
      entityType: "User",
      entityId: userId,
      after: { employeeCode: existing.employeeCode, outcome, via: "admin-bootstrap CLI" },
    });
    return {
      outcome,
      employeeId: existing.id,
      userId,
      employeeCode: existing.employeeCode,
      account: existing.user.status === "INVITED" ? "invited" : "active",
      invitedEmail: existing.user.status === "INVITED" ? email : null,
      link,
    };
  }

  const missing = NEW_EMPLOYEE_FIELDS.filter((f) => !input[f]);
  if (missing.length) throw new AdminCliRefusal(`Employee ${input.employeeCode} doesn't exist yet, so these are needed to create it: ${missing.join(", ")}.`);
  const d = input as Required<typeof input>;

  // A minimal employee: identity and contact only. Job placement
  // (department, designation, location), addresses and emergency contact are
  // completed in the portal once the organisation masters exist — a fresh
  // production database has none yet.
  const { employeeId, userId } = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.create({
      data: {
        employeeCode: d.employeeCode,
        officialEmail: input.officialEmail ?? null,
        dateOfJoining: new Date(d.dateOfJoining),
        employmentType: "PERMANENT",
        status: "ACTIVE",
      },
    });
    const user = await tx.user.create({ data: { employeeId: employee.id, status: "INVITED" } });
    await tx.userRole.create({ data: { userId: user.id, roleId: superAdminRole.id, assignedByUserId: null } });
    if (employeeRole) await tx.userRole.create({ data: { userId: user.id, roleId: employeeRole.id, assignedByUserId: null } });
    await tx.employeePersonal.create({
      data: {
        employeeId: employee.id,
        dateOfBirth: new Date(d.dateOfBirth),
        gender: d.gender,
        personalEmail: d.personalEmail,
        mobile: d.mobile,
        currentAddress: PLACEHOLDER,
        permanentAddress: PLACEHOLDER,
        emergencyContactName: PLACEHOLDER,
        emergencyContactPhone: d.mobile,
        emergencyContactRelation: PLACEHOLDER,
      },
    });
    // No one is signed in to attribute this to; the new user is its own author.
    await tx.employeeNameHistory.create({
      data: { employeeId: employee.id, fullName: d.fullName, effectiveFrom: new Date(d.dateOfJoining), createdByUserId: user.id },
    });
    return { employeeId: employee.id, userId: user.id };
  });

  const { link } = await createInvitation({ userId, email: d.personalEmail, fullName: d.fullName, employeeCode: d.employeeCode });
  await writeAuditLog({
    actorUserId: null,
    action: "access.super_admin.bootstrapped",
    entityType: "User",
    entityId: userId,
    after: { employeeCode: d.employeeCode, outcome: "created", via: "admin-bootstrap CLI" },
  });
  return { outcome: "created", employeeId, userId, employeeCode: d.employeeCode, account: "invited", invitedEmail: d.personalEmail, link };
}
