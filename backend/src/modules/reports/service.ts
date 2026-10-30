import { REPORT_CATALOG, REPORT_KEYS, type ReportKey, type ReportResult } from "@shared/constants/reports";
import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { prisma } from "../../lib/prisma";
import { buildXlsx } from "../../lib/xlsx";
import { HttpError } from "../../middleware/errorHandler";
import { populationFor, type ReportQuery, type ReportViewer } from "./context";
import { REPORT_DEFINITIONS } from "./definitions";

// Core reports (Phase 5 commit F). The route gate is reports.view; a
// report with an extraPermission (leave liability) also needs that key.

export interface Meta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function canOpen(key: ReportKey, viewer: ReportViewer): boolean {
  const { extraPermission, permission } = REPORT_CATALOG[key];
  return (!permission || viewer.permissions.has(permission)) && (!extraPermission || viewer.permissions.has(extraPermission));
}

const missingFor = (key: ReportKey, viewer: ReportViewer): string => {
  const { extraPermission, permission } = REPORT_CATALOG[key];
  return permission && !viewer.permissions.has(permission) ? permission : (extraPermission ?? "reports.view");
};

export function catalogFor(viewer: ReportViewer) {
  return REPORT_KEYS.filter((k) => canOpen(k, viewer)).map((k) => REPORT_CATALOG[k]);
}

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = { PERMANENT: "Permanent", CONTRACT: "Contract", INTERN: "Intern", CONSULTANT: "Consultant", PROBATION: "Probation" };

async function describeFilters(key: ReportKey, q: ReportQuery): Promise<string[]> {
  const out: string[] = [];
  const f = REPORT_CATALOG[key].filters;
  if (f.includes("asOf")) out.push(`As of ${q.asOf ?? businessToday().toISOString().slice(0, 10)}`);
  if (f.includes("range") && (q.from || q.to)) out.push(`From ${q.from ?? "default"} to ${q.to ?? "default"}`);
  if (q.departmentId) out.push(`Department: ${(await prisma.department.findUnique({ where: { id: q.departmentId }, select: { name: true } }))?.name ?? "unknown"}`);
  if (q.locationId) out.push(`Branch: ${(await prisma.location.findUnique({ where: { id: q.locationId }, select: { name: true } }))?.name ?? "unknown"}`);
  if (q.employmentType) out.push(`Employment type: ${EMPLOYMENT_TYPE_LABEL[q.employmentType] ?? q.employmentType}`);
  if (q.leaveTypeId) out.push(`Leave type: ${(await prisma.leaveType.findUnique({ where: { id: q.leaveTypeId }, select: { name: true } }))?.name ?? "unknown"}`);
  if (q.kind && q.kind !== "all") out.push(q.kind === "birthday" ? "Birthdays only" : "Anniversaries only");
  return out;
}

export async function runReport(key: ReportKey, q: ReportQuery, viewer: ReportViewer): Promise<ReportResult> {
  if (!canOpen(key, viewer)) throw new HttpError(403, `Missing permission: ${missingFor(key, viewer)}`, "FORBIDDEN");
  const pop = await populationFor(viewer);
  const body = await REPORT_DEFINITIONS[key](q, pop);
  return {
    key,
    title: REPORT_CATALOG[key].title,
    scope: pop.ids === null ? "company" : "team",
    generatedAt: new Date().toISOString(),
    filtersApplied: await describeFilters(key, q),
    ...body,
  };
}

export async function exportReport(key: ReportKey, q: ReportQuery, viewer: ReportViewer, meta: Meta): Promise<{ buffer: Buffer; fileName: string }> {
  const r = await runReport(key, q, viewer);
  const footer = [
    `${r.title} — generated ${new Date(r.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
    ...(r.scope === "team" ? ["Team only: limited to the people in your data scope."] : []),
    ...r.filtersApplied,
    ...r.warnings,
    ...(r.rateProvisional ? ["The encashment daily rate is provisional, pending CA confirmation of the formula and its tax treatment (spec §5.2)."] : []),
    ...r.notes,
  ];
  const buffer = await buildXlsx([
    { name: r.title, columns: r.columns, rows: r.rows, footer },
    {
      name: "Summary",
      columns: [
        { key: "label", header: "Measure", width: 34 },
        { key: "value", header: "Value", width: 18 },
      ],
      rows: r.summary.map((s) => ({ label: s.label, value: s.type === "percent" && typeof s.value === "number" ? `${(s.value * 100).toFixed(1)}%` : (s.value ?? "—") })),
    },
    ...r.breakdowns.map((b) => ({ name: b.title, columns: b.columns, rows: b.rows })),
  ]);
  await writeAuditLog({
    ...meta,
    action: "report.exported",
    entityType: "Report",
    entityId: key,
    after: { report: key, scope: r.scope, rowCount: r.rows.length, filters: r.filtersApplied },
  });
  return { buffer, fileName: `${key}-${businessToday().toISOString().slice(0, 10)}.xlsx` };
}
