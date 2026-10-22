import type { PrismaClient } from "@prisma/client";

// The demo company (docs/plans/PHASE_6.md §14J) is made-up people with made-up pay, for developing and showing payroll. It must never exist where real people's pay is: outside
// development the application refuses to start if it finds the demo setting or any person whose employee code begins DEMO. (The script that makes it also refuses outside development.)
export const DEMO_SETTING_KEY = "demo.company";

export async function demoCompanyPresent(db: Pick<PrismaClient, "systemSetting" | "employee">): Promise<boolean> {
  const setting = await db.systemSetting.findUnique({ where: { key: DEMO_SETTING_KEY } });
  if (setting?.value === true) return true;
  return (await db.employee.count({ where: { employeeCode: { startsWith: "DEMO" } } })) > 0;
}

export async function assertNoDemoCompany(db: Pick<PrismaClient, "systemSetting" | "employee">, appEnv: string): Promise<void> {
  if (appEnv === "development") return;
  if (await demoCompanyPresent(db)) {
    throw new Error(`Refusing to start: APP_ENV is "${appEnv}" but this database holds the DEMO COMPANY (made-up people, salaries and a fictional bank format, made by seed:demo-company). It must never exist where real people's pay is. Use a database that has never had it.`);
  }
}
