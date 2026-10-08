import type { DirectoryToggleableField } from "@shared/constants/peopleDocuments";
import { prisma } from "../../lib/prisma";
import { getPeopleDocumentsSettings } from "../../lib/peopleDocumentsSettings";
import { isTopLevel, MANAGER_ROLE_CODE } from "../../lib/reportingHierarchy";
import { HttpError } from "../../middleware/errorHandler";
import { DIRECTORY_FIELD_POLICY } from "./fieldPolicy";
import { inForceOn } from "../../lib/effectiveDating";

// People directory + org chart (spec §6 "People", Phase 5 commit C).
// Every signed-in employee can use both; only ACTIVE employees appear, and
// only fields DIRECTORY_FIELD_POLICY allows (plus the current settings'
// toggles) ever leave the server.

export interface DirectoryEntry {
  id: string;
  employeeCode: string;
  name: string;
  photoVersion: string | null;
  designation: { id: string; name: string };
  department: { id: string; name: string };
  location: { id: string; name: string };
  officialEmail?: string | null;
  mobile?: string;
  personalEmail?: string;
  birthday?: string; // "MM-DD" — never the year
  dateOfJoining?: string;
  reportingManager?: { id: string; name: string } | null;
}

// Selects exactly the columns the policy can ever show (never the whole row).
const DIRECTORY_SELECT = () => ({
  id: true,
  employeeCode: true,
  officialEmail: true,
  dateOfJoining: true,
  personal: { select: { dateOfBirth: true, personalEmail: true, mobile: true, photoVersion: true } },
  nameHistory: { where: inForceOn(), select: { fullName: true } },
  jobHistory: {
    where: inForceOn(),
    select: {
      designation: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      reportingManager: {
        select: { id: true, status: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } },
      },
    },
  },
}) as const;

type DirectoryRow = Awaited<ReturnType<typeof loadDirectoryRows>>[number];

async function loadDirectoryRows(where: object) {
  return prisma.employee.findMany({
    where: { status: "ACTIVE", jobHistory: { some: inForceOn() }, ...where },
    select: DIRECTORY_SELECT(),
  });
}

// Guards the projection below against drifting from the policy: a column
// can only be emitted if the policy says so for the current settings.
function allowed(column: string, visible: Set<DirectoryToggleableField>): boolean {
  const policy = DIRECTORY_FIELD_POLICY[column];
  if (!policy) throw new Error(`Directory projection uses unclassified column ${column}`);
  if (policy.shown === "always") return true;
  if (policy.shown === "setting") return visible.has(policy.setting);
  return false;
}

function toEntry(row: DirectoryRow, visible: Set<DirectoryToggleableField>): DirectoryEntry {
  const job = row.jobHistory[0]!;
  const entry: DirectoryEntry = {
    id: row.id,
    employeeCode: row.employeeCode,
    name: row.nameHistory[0]?.fullName ?? row.employeeCode,
    photoVersion: allowed("EmployeePersonal.photoVersion", visible) ? (row.personal?.photoVersion ?? null) : null,
    designation: job.designation,
    department: job.department,
    location: job.location,
  };
  if (allowed("Employee.officialEmail", visible)) entry.officialEmail = row.officialEmail;
  if (allowed("Employee.dateOfJoining", visible)) entry.dateOfJoining = row.dateOfJoining.toISOString().slice(0, 10);
  if (row.personal) {
    if (allowed("EmployeePersonal.mobile", visible)) entry.mobile = row.personal.mobile;
    if (allowed("EmployeePersonal.personalEmail", visible)) entry.personalEmail = row.personal.personalEmail;
    if (allowed("EmployeePersonal.dateOfBirth", visible)) entry.birthday = row.personal.dateOfBirth.toISOString().slice(5, 10);
  }
  if (visible.has("reportingManager")) {
    const m = job.reportingManager;
    entry.reportingManager = m && m.status === "ACTIVE" ? { id: m.id, name: m.nameHistory[0]?.fullName ?? m.employeeCode } : null;
  }
  return entry;
}

async function visibleFields(): Promise<Set<DirectoryToggleableField>> {
  return new Set((await getPeopleDocumentsSettings()).directoryVisibleFields);
}

export interface ListDirectoryQuery {
  search?: string;
  departmentId?: string;
  locationId?: string;
  page: number;
  pageSize: number;
}

export async function listDirectory(query: ListDirectoryQuery) {
  const search = query.search?.trim();
  const where = {
    ...(search && {
      OR: [
        { employeeCode: { contains: search, mode: "insensitive" as const } },
        { nameHistory: { some: { ...inForceOn(), fullName: { contains: search, mode: "insensitive" as const } } } },
      ],
    }),
    ...((query.departmentId || query.locationId) && {
      jobHistory: {
        some: {
          ...inForceOn(),
          ...(query.departmentId && { departmentId: query.departmentId }),
          ...(query.locationId && { locationId: query.locationId }),
        },
      },
    }),
  };
  const [rows, visible] = await Promise.all([loadDirectoryRows(where), visibleFields()]);
  // Sorted by name in memory — name lives in effective-dated history, which
  // Prisma can't order by; fine at this headcount (same approach as the
  // All Employees grid, employee/grid.ts).
  const entries = rows.map((r) => toEntry(r, visible)).sort((a, b) => a.name.localeCompare(b.name));
  const start = (query.page - 1) * query.pageSize;
  return {
    items: entries.slice(start, start + query.pageSize),
    total: entries.length,
    page: query.page,
    pageSize: query.pageSize,
    visibleFields: [...visible],
  };
}

export async function getDirectoryEntry(employeeId: string): Promise<DirectoryEntry> {
  const [rows, visible] = await Promise.all([loadDirectoryRows({ id: employeeId }), visibleFields()]);
  // Not ACTIVE, or no current job row → indistinguishable from "doesn't exist".
  if (rows.length === 0) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  return toEntry(rows[0]!, visible);
}

// ── Org chart ─────────────────────────────────────────────────────────
// One compact payload for the whole company: per-node ids only, with
// designation/department/branch names sent once as lookup maps rather than
// repeated on every node. Draws whatever reporting lines exist (the
// three-level rule is asserted for the seed and enforced in commit E);
// the frontend renders collapsed branches lazily.

// E2: what a person is in the three-level structure — so the chart can tell
// a manager with no team ("No team yet") from a plain employee, and an HR
// Admin (top level, never a team) from both.
export type OrgChartKind = "admin" | "manager" | "adminStaff" | "employee";

export interface OrgChartNode {
  id: string;
  kind: OrgChartKind;
  code: string;
  name: string;
  photoVersion: string | null;
  designationId: string;
  departmentId: string;
  locationId: string;
  managerId: string | null;
}

export async function getOrgChart() {
  const rows = await prisma.employee.findMany({
    where: { status: "ACTIVE", jobHistory: { some: inForceOn() } },
    select: {
      id: true,
      employeeCode: true,
      personal: { select: { photoVersion: true } },
      nameHistory: { where: inForceOn(), select: { fullName: true } },
      jobHistory: {
        where: inForceOn(),
        select: { designationId: true, departmentId: true, locationId: true, reportingManagerId: true },
      },
      user: { select: { roles: { select: { role: { select: { code: true } } } } } },
    },
  });
  const activeIds = new Set(rows.map((r) => r.id));
  const rolesById = new Map(rows.map((r) => [r.id, r.user?.roles.map((ur) => ur.role.code) ?? []]));
  const kindOf = (roles: string[]): OrgChartKind =>
    roles.includes("SUPER_ADMIN") ? "admin" : roles.includes(MANAGER_ROLE_CODE) ? "manager" : isTopLevel(roles) ? "adminStaff" : "employee";
  const nodes: OrgChartNode[] = rows.map((r) => {
    const job = r.jobHistory[0]!;
    const managerId = job.reportingManagerId;
    return {
      id: r.id,
      kind: kindOf(rolesById.get(r.id)!),
      code: r.employeeCode,
      name: r.nameHistory[0]?.fullName ?? r.employeeCode,
      photoVersion: r.personal?.photoVersion ?? null,
      designationId: job.designationId,
      departmentId: job.departmentId,
      locationId: job.locationId,
      // Only an active Manager anchors anyone (model A); anything else is
      // shown as unassigned rather than drawn as a line the rules forbid.
      managerId: managerId && activeIds.has(managerId) && rolesById.get(managerId)!.includes(MANAGER_ROLE_CODE) ? managerId : null,
    };
  });
  nodes.sort((a, b) => a.name.localeCompare(b.name));

  // Model A: the synthetic Admin root names the Super Admins; directly under
  // it sit the managers and HR Admins. Anyone else without a manager is
  // unassigned.
  const adminIds = nodes.filter((n) => n.kind === "admin").map((n) => n.id);
  const rootIds = nodes.filter((n) => n.kind === "manager" || n.kind === "adminStaff").map((n) => n.id);
  const unassignedIds = nodes.filter((n) => n.kind === "employee" && n.managerId === null).map((n) => n.id);

  const [designations, departments, locations] = await Promise.all([
    prisma.designation.findMany({ where: { id: { in: [...new Set(nodes.map((n) => n.designationId))] } }, select: { id: true, name: true } }),
    prisma.department.findMany({ where: { id: { in: [...new Set(nodes.map((n) => n.departmentId))] } }, select: { id: true, name: true } }),
    prisma.location.findMany({ where: { id: { in: [...new Set(nodes.map((n) => n.locationId))] } }, select: { id: true, name: true } }),
  ]);
  const toMap = (list: { id: string; name: string }[]) => Object.fromEntries(list.map((x) => [x.id, x.name]));
  return {
    nodes,
    adminIds,
    rootIds,
    unassignedIds,
    designations: toMap(designations),
    departments: toMap(departments),
    locations: toMap(locations),
  };
}
