import { businessToday } from "../../lib/businessDate";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { listMine } from "../assets/service";
import type { PeepsActor } from "../peeps/types";
import { mine as myBadges } from "../recognition/badges";
import { currentFor } from "./choices";

// My profile (D-35): the employee's own role, department, grade, code, joining date and tenure, who they report to, their direct reports, their earned
// badges, their assigned assets and their own work email, phone and birthday. Self only: another person's profile is their directory entry (fields as
// the directory setting allows) plus their badges. Pay, bank, statutory, medical and private Peeps data are never here.

const nameOf = (e: { employeeCode: string; nameHistory: { fullName: string }[] }) => e.nameHistory[0]?.fullName ?? e.employeeCode;

function tenure(from: Date, to: Date): { years: number; months: number } {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12 };
}

export async function myProfile(actor: PeepsActor & { dataScope: string; permissions: Set<string> }) {
  const e = await prisma.employee.findUnique({
    where: { id: actor.employeeId },
    select: {
      id: true,
      employeeCode: true,
      officialEmail: true,
      dateOfJoining: true,
      personal: { select: { mobile: true, dateOfBirth: true, photoVersion: true } },
      nameHistory: { where: inForceOn(), select: { fullName: true } },
      jobHistory: {
        where: inForceOn(),
        select: {
          designation: { select: { name: true } },
          department: { select: { name: true } },
          grade: { select: { name: true } },
          location: { select: { name: true } },
          reportingManager: { select: { id: true, employeeCode: true, status: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } },
        },
      },
    },
  });
  if (!e) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const job = e.jobHistory[0];
  const reports = await prisma.employee.findMany({
    where: { status: "ACTIVE", jobHistory: { some: { ...inForceOn(), reportingManagerId: e.id } } },
    select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } }, jobHistory: { where: inForceOn(), select: { designation: { select: { name: true } } } } },
    orderBy: { employeeCode: "asc" },
  });
  const assets = await listMine({ userId: actor.userId, employeeId: actor.employeeId, dataScope: actor.dataScope as never, permissions: actor.permissions });
  const badges = (await myBadges(actor)).filter((b) => b.active);
  const manager = job?.reportingManager && job.reportingManager.status === "ACTIVE" ? job.reportingManager : null;
  return {
    employeeId: e.id,
    name: nameOf(e),
    employeeCode: e.employeeCode,
    role: job?.designation.name ?? null,
    department: job?.department.name ?? null,
    grade: job?.grade?.name ?? null,
    location: job?.location.name ?? null,
    dateOfJoining: e.dateOfJoining.toISOString().slice(0, 10),
    tenure: tenure(e.dateOfJoining, businessToday()),
    reportsTo: manager ? { employeeId: manager.id, employeeCode: manager.employeeCode, name: nameOf(manager) } : null,
    directReports: reports.map((r) => ({ employeeId: r.id, employeeCode: r.employeeCode, name: nameOf(r), role: r.jobHistory[0]?.designation.name ?? null })),
    badges,
    assets: assets.current.map((a) => ({ assetId: a.assetId, name: a.name, category: a.category, issuedAt: a.issuedAt })),
    personal: { workEmail: e.officialEmail, phone: e.personal?.mobile ?? null, birthday: e.personal ? e.personal.dateOfBirth.toISOString().slice(0, 10) : null },
    photoVersion: e.personal?.photoVersion ?? null,
    avatar: await currentFor(e.id),
  };
}
