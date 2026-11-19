import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

// Employee-number login (docs/plans/LOGIN_CHECKLIST.md, owner decision 2026-11-17): the employee number is the login ID and the attendance
// machine ID. It is text (leading zeros and letters allowed), unique per company, and matched exactly after trimming spaces and ignoring case.
// The database enforces the same rule with a unique index on lower(btrim(employee_code)) (migration login_employee_number), and the lookup below
// uses that same expression.
//
// Deliberately raw SQL with `=`, not Prisma's `mode: "insensitive"`: that can compile to ILIKE, where a typed "%" or "_" is a wildcard, so
// "10_1" could sign someone in as "1001". Here every character is literal.

/** The login ID as typed, with surrounding spaces removed. Case is kept for display; matching ignores it. */
export function normaliseLoginId(raw: string): string {
  return raw.trim();
}

/** The id of the one employee holding this login ID, or null. */
export async function findEmployeeIdByLoginId(raw: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<string | null> {
  const id = normaliseLoginId(raw);
  if (!id) return null;
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM employees WHERE lower(btrim(employee_code)) = lower(${id}) LIMIT 1`);
  return rows[0]?.id ?? null;
}

/** Is this employee number already held by someone (case and surrounding spaces ignored)? `exceptEmployeeId` skips the person being changed. */
export async function loginIdTaken(raw: string, exceptEmployeeId?: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<{ employeeCode: string } | null> {
  const id = normaliseLoginId(raw);
  const rows = await db.$queryRaw<Array<{ employee_code: string }>>(
    Prisma.sql`SELECT employee_code FROM employees WHERE lower(btrim(employee_code)) = lower(${id}) AND id <> ${exceptEmployeeId ?? ""} LIMIT 1`,
  );
  return rows[0] ? { employeeCode: rows[0].employee_code } : null;
}
