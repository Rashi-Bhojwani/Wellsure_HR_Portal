import { prisma } from "../../lib/prisma";
import { inForceOn } from "../../lib/effectiveDating";

// A minimal, self-serve "who can I give kudos to / @-mention" lookup —
// name + code only, no sensitive data — deliberately separate from
// modules/employee's own listEmployees, which is gated behind
// employee.view (a plain EMPLOYEE doesn't hold it, but must still be able
// to search colleagues to give them kudos). People/commit C's directory
// will eventually cover this same need more generally; this stays
// scoped to Engage until then.
export async function searchEmployeesForPicker(search: string, excludeEmployeeId: string) {
  const rows = await prisma.employee.findMany({
    where: {
      status: "ACTIVE",
      id: { not: excludeEmployeeId },
      OR: [
        { employeeCode: { contains: search, mode: "insensitive" } },
        { nameHistory: { some: { ...inForceOn(), fullName: { contains: search, mode: "insensitive" } } } },
      ],
    },
    select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } },
    take: 10,
  });
  return rows.map((r) => ({ id: r.id, employeeCode: r.employeeCode, name: r.nameHistory[0]?.fullName ?? r.employeeCode }));
}
