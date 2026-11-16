import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";

// Part 3 B2 (docs/plans/A_PART3.md; owner decision 2026-11-13): a payroll run is for one company. A run with no company tag is the main company's; an employee with no
// company row (the other session's employee_legal_entities) belongs to the main company. With one company nothing here changes who a run pays.
export const MAIN = "MAIN";

export async function companyKeyOfRun(runId: string): Promise<string> {
  const tag = await prisma.payrollRunCompany.findUnique({ where: { runId }, select: { legalEntityId: true } });
  return tag?.legalEntityId ?? MAIN;
}

/** Prisma `where` on Employee: the people of a company. */
export function companyWhere(key: string) {
  return key === MAIN ? { legalEntity: { is: null } } : { legalEntity: { is: { legalEntityId: key } } };
}

/** Bank and statutory files of a run for another company are not made yet: they need that company's own registrations and bank details (Not set). */
export async function refuseFilesForOtherCompany(runId: string, what: string): Promise<void> {
  if ((await companyKeyOfRun(runId)) !== MAIN) throw new HttpError(409, `The ${what} for a run of another company is not made yet: it needs that company's own registrations and bank details (Payroll → Company settings).`, "COMPANY_FILES_NOT_BUILT");
}
