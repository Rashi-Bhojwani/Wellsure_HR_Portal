import { PrismaClient, EmploymentType, Gender, Prisma } from "@prisma/client";
import argon2 from "argon2";
import { PERMISSION_KEYS } from "@shared/constants/permissions";
import { encryptField } from "../src/lib/encryption";
import { blindIndex, normalizePan, normalizeAadhaar, normalizeAccountNumber } from "../src/lib/fieldHash";
import { assertDevelopmentEnvironment } from "../src/lib/devGuard";

assertDevelopmentEnvironment("the Phase 1 seed script (inserts fake employee/bank/statutory data)");

// Seed data for Phase 1 — see docs/PROGRESS.md for what's still an open
// question (branch list, Panchsheel city assignment, actual headcount).
// Assumes an empty, freshly migrated database: run via `npm run db:seed`
// (which does `prisma migrate reset --force`, dropping/recreating the DB
// and re-running this script), not by invoking this file directly.

const prisma = new PrismaClient();

// Known password for every seeded ACTIVE account — local/demo data only.
const DEV_PASSWORD = "Wellsure@123";

function fakePan(n: number): string {
  const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = String(1000 + n).slice(-4);
  return `${L[n % 26]}${L[(n * 3) % 26]}${L[(n * 7) % 26]}P${L[(n * 11) % 26]}${digits}${L[(n * 13) % 26]}`;
}
function fakeAadhaar(n: number): string {
  return String(200000000000 + n * 37);
}
function fakeUan(n: number): string {
  return String(100000000000 + n * 41);
}
function fakeAccountNumber(n: number): string {
  return String(30000000000000 + n * 6301);
}

const IFSC_BANKS = [
  { ifsc: "SBIN0001234", bankName: "State Bank of India" },
  { ifsc: "HDFC0000456", bankName: "HDFC Bank" },
  { ifsc: "ICIC0001789", bankName: "ICICI Bank" },
];

interface EmployeeSpec {
  employeeCode: string;
  deviceUserId: string;
  fullName: string;
  gender: Gender;
  dob: string;
  doj: string;
  employmentType: EmploymentType;
  deptCode: string;
  designationCode: string;
  gradeCode: string;
  costCentreCode: string;
  locationCode: string;
  managerCode?: string;
  account: "active" | "invited" | "locked" | "separated";
  lastWorkingDate?: string;
}

async function main() {
  console.log("Seeding Phase 1 data...");

  // ── Company ──────────────────────────────────────────────────────────
  await prisma.company.create({
    data: { name: "Wellsure" /* placeholder legal entity name, pending confirmation */ },
  });

  // ── Cities (open question: which city each Panchsheel branch belongs
  // to is unconfirmed — seeded under a placeholder "Delhi" — see
  // docs/PROGRESS.md) ──────────────────────────────────────────────────
  const ajmer = await prisma.city.create({ data: { name: "Ajmer", state: "Rajasthan" } });
  const delhi = await prisma.city.create({ data: { name: "Delhi", state: "Delhi" } });

  // ── Locations (branches) — placeholder names/addresses pending HR's
  // confirmed list (docs/PROGRESS.md). 3 Ajmer branches + the 3 Panchsheel
  // branches from greytHR, plus one deliberately misspelled near-duplicate
  // as the Organisation Setup merge-flow fixture. ─────────────────────
  const locations = await Promise.all([
    prisma.location.create({
      data: {
        code: "AJM-1",
        name: "Ajmer Branch 1",
        cityId: ajmer.id,
        addressLine1: "Placeholder address 1, Ajmer",
        city: "Ajmer",
        state: "Rajasthan",
        pincode: "305001",
      },
    }),
    prisma.location.create({
      data: {
        code: "AJM-2",
        name: "Ajmer Branch 2",
        cityId: ajmer.id,
        addressLine1: "Placeholder address 2, Ajmer",
        city: "Ajmer",
        state: "Rajasthan",
        pincode: "305001",
      },
    }),
    prisma.location.create({
      data: {
        code: "AJM-3",
        name: "Ajmer Branch 3",
        cityId: ajmer.id,
        addressLine1: "Placeholder address 3, Ajmer",
        city: "Ajmer",
        state: "Rajasthan",
        pincode: "305001",
      },
    }),
    prisma.location.create({
      data: {
        code: "PAN-C10",
        name: "C-10 Panchsheel",
        cityId: delhi.id,
        addressLine1: "C-10 Panchsheel",
        city: "Delhi",
        state: "Delhi",
        pincode: "110017",
      },
    }),
    prisma.location.create({
      data: {
        code: "PAN-SPN",
        name: "SPN-Panchsheel",
        cityId: delhi.id,
        addressLine1: "SPN Panchsheel",
        city: "Delhi",
        state: "Delhi",
        pincode: "110017",
      },
    }),
    prisma.location.create({
      data: {
        code: "PAN-B22",
        name: "B-22 Panchsheel",
        cityId: delhi.id,
        addressLine1: "B-22 Panchsheel",
        city: "Delhi",
        state: "Delhi",
        pincode: "110017",
      },
    }),
    // Merge-flow fixture: a near-duplicate of PAN-C10 with a typo, not an
    // exact duplicate (the `name` unique constraint would reject an exact
    // one) — Organisation Setup's near-duplicate detection should flag
    // this pair for HR to merge.
    prisma.location.create({
      data: {
        code: "PAN-C10-DUP",
        name: "C-10 Panchsheeel",
        cityId: delhi.id,
        addressLine1: "C-10 Panchsheel (duplicate entry — merge fixture)",
        city: "Delhi",
        state: "Delhi",
        pincode: "110017",
      },
    }),
  ]);
  const loc = Object.fromEntries(locations.map((l) => [l.code, l]));

  // ── Departments / Designations / Grades / Cost Centres — generic,
  // editable via Organisation Setup; not specified anywhere in the spec. ─
  const DEPARTMENTS: Array<[string, string]> = [
    ["ENG", "Engineering"],
    ["HR", "Human Resources"],
    ["FIN", "Finance & Accounts"],
    ["SALES", "Sales & Marketing"],
    ["OPS", "Operations"],
    ["ADMIN", "Administration"],
  ];
  const departments = await Promise.all(
    DEPARTMENTS.map(([code, name]) => prisma.department.create({ data: { code, name } })),
  );
  const dept = Object.fromEntries(departments.map((d) => [d.code, d]));

  const DESIGNATIONS: Array<[string, string]> = [
    ["EXEC", "Executive"],
    ["SR_EXEC", "Senior Executive"],
    ["ASST_MGR", "Assistant Manager"],
    ["MGR", "Manager"],
    ["SR_MGR", "Senior Manager"],
    ["ASSOC_DIR", "Associate Director"],
    ["DIR", "Director"],
  ];
  const designations = await Promise.all(
    DESIGNATIONS.map(([code, name]) => prisma.designation.create({ data: { code, name } })),
  );
  const desig = Object.fromEntries(designations.map((d) => [d.code, d]));

  const GRADES: Array<[string, string, number]> = [
    ["G1", "Grade 1", 1],
    ["G2", "Grade 2", 2],
    ["G3", "Grade 3", 3],
    ["G4", "Grade 4", 4],
    ["G5", "Grade 5", 5],
    ["G6", "Grade 6", 6],
  ];
  const grades = await Promise.all(
    GRADES.map(([code, name, rank]) => prisma.grade.create({ data: { code, name, rank } })),
  );
  const grade = Object.fromEntries(grades.map((g) => [g.code, g]));

  const COST_CENTRES: Array<[string, string]> = [
    ["CC-ENG", "Engineering"],
    ["CC-HR", "Human Resources"],
    ["CC-FIN", "Finance & Accounts"],
    ["CC-SALES", "Sales & Marketing"],
    ["CC-OPS", "Operations"],
    ["CC-ADMIN", "Administration"],
  ];
  const costCentres = await Promise.all(
    COST_CENTRES.map(([code, name]) => prisma.costCentre.create({ data: { code, name } })),
  );
  const cc = Object.fromEntries(costCentres.map((c) => [c.code, c]));

  // ── Leave (Phase 4, spec §5) — types + policies, configurable, not
  // hardcoded: HR edits these live via Admin Tools -> Leave Types &
  // Policies once that screen exists (commit C). Fields marked
  // "HR-confirmed" match the exact business rules HR gave; everything
  // else is a sensible default, listed as an open question in
  // docs/PROGRESS.md until HR confirms it. ─────────────────────────────
  const plType = await prisma.leaveType.create({
    data: { code: "PL", name: "Privilege / Earned Leave", isPaid: true, allowHalfDay: true },
  });
  await prisma.leavePolicy.create({
    data: {
      leaveTypeId: plType.id,
      accrualEnabled: true,
      accrualDaysPerMonth: 1.0,
      eligibilityMode: "DAYS", // HR-confirmed
      eligibilityValue: 90, // HR-confirmed: 90-day waiting period from DOJ
      carryForwardCapDays: null, // HR-confirmed: no cap
      negativeBalanceAllowed: false, // HR-confirmed
      yearEndEncashment: true, // HR-confirmed
    },
  });

  const lopType = await prisma.leaveType.create({
    data: { code: "LOP", name: "Loss of Pay", isPaid: false, allowHalfDay: true },
  });
  await prisma.leavePolicy.create({
    data: { leaveTypeId: lopType.id, skipBalanceCheck: true }, // HR-confirmed: LOP has no balance concept at all
  });

  const cofType = await prisma.leaveType.create({
    data: { code: "COF", name: "Comp-Off", isPaid: true, allowHalfDay: true },
  });
  await prisma.leavePolicy.create({
    data: {
      leaveTypeId: cofType.id,
      compOffMinHoursWorked: 4.0, // pending HR confirmation — see docs/PROGRESS.md open questions
      compOffExpiryDays: 60, // pending HR confirmation — see docs/PROGRESS.md open questions
    },
  });

  const wfhType = await prisma.leaveType.create({
    data: { code: "WFH", name: "Work From Home", isPaid: true, allowHalfDay: true },
  });
  await prisma.leavePolicy.create({
    data: {
      leaveTypeId: wfhType.id,
      wfhMonthlyLimit: null, // pending HR confirmation — default unlimited, see docs/PROGRESS.md
      wfhYearlyLimit: null,
    },
  });

  const rhType = await prisma.leaveType.create({
    data: { code: "RH", name: "Restricted Holiday", isPaid: true, allowHalfDay: false },
  });
  await prisma.leavePolicy.create({
    data: { leaveTypeId: rhType.id, rhYearlyQuota: 2 }, // pending HR confirmation — see docs/PROGRESS.md
  });

  // ── Holidays / Restricted Holidays — company-wide (HR-confirmed
  // 2026-09-28: identical for every branch, see schema.prisma's comment
  // on the Holiday model), example 2026 dates. HR edits these via Admin
  // Tools -> Holiday Calendars. ─────────────────────────────────────────
  const HOLIDAYS_2026: Array<[string, string]> = [
    ["2026-01-26", "Republic Day"],
    ["2026-03-04", "Holi"],
    ["2026-08-15", "Independence Day"],
    ["2026-10-02", "Gandhi Jayanti"],
    ["2026-10-21", "Dussehra"],
    ["2026-11-08", "Diwali"],
    ["2026-12-25", "Christmas"],
  ];
  const RESTRICTED_HOLIDAYS_2026: Array<[string, string]> = [
    ["2026-01-14", "Makar Sankranti"],
    ["2026-04-14", "Ambedkar Jayanti"],
    ["2026-08-28", "Ganesh Chaturthi"],
    ["2026-12-24", "Christmas Eve"],
  ];
  await prisma.holiday.createMany({
    data: HOLIDAYS_2026.map(([date, name]) => ({ date: new Date(date), name })),
  });
  await prisma.restrictedHoliday.createMany({
    data: RESTRICTED_HOLIDAYS_2026.map(([date, name]) => ({ date: new Date(date), name })),
  });

  // ── Permissions + Roles ─────────────────────────────────────────────
  const permissions = await Promise.all(
    PERMISSION_KEYS.map((key) =>
      prisma.permission.create({ data: { key, description: key.replace(/\./g, " ").replace(/_/g, " ") } }),
    ),
  );
  const perm = Object.fromEntries(permissions.map((p) => [p.key, p]));

  // HR_EXECUTIVE deliberately excludes employee.statutory.* and
  // employee.bank.* — spec §2 says "no salary or bank data"; PAN/Aadhaar/
  // UAN are held to the same bar as bank data here, so HR_EXECUTIVE is
  // blocked from both reveal endpoints, not just bank (commit C IDOR test
  // covers this explicitly).
  const HR_EXECUTIVE_PERMS = [
    "employee.view",
    "employee.create",
    "employee.edit",
    "employee.export",
    "employee.manage",
    "employee.separate",
    "employee.separate.view",
    "profile.changerequest.approve",
    "org.manage",
    "import.manage",
    "role.view",
    // Phase 4 — leave administration stays with HR_EXECUTIVE; config/
    // financial actions (policy.manage/recalculate/yearend.manage) are
    // HR_ADMIN+ only, same narrowing as settings.manage/import.manage.
    "leave.view",
    "leave.approve",
    "leave.grant",
    "leave.apply.onBehalf",
  ];
  const HR_ADMIN_PERMS = [
    ...HR_EXECUTIVE_PERMS,
    "employee.statutory.view",
    "employee.statutory.edit",
    "employee.bank.view",
    "employee.bank.edit",
    "user.security.manage",
    "audit.view",
    "settings.manage",
    "leave.policy.manage",
    "leave.recalculate",
    "leave.yearend.manage",
    // Phase 5 — config/financial actions stay HR_ADMIN+, same narrowing as settings.manage/leave.policy.manage
    "announcements.manage",
    "engage.moderate",
    "engage.groups.manage",
    "engage.autopost.manage",
  ];
  const PAYROLL_ADMIN_PERMS = ["employee.view", "employee.bank.view", "employee.statutory.view", "leave.view"];
  // leave.approve/leave.view here is a real fix over commit A's original
  // seed, caught while designing commit B's approve endpoint: MANAGER is
  // TEAM-scoped via resolveDataScope, but scope alone doesn't grant a
  // permission — without these, no manager could ever approve their own
  // team's leave, contradicting "Manager and HR: approve/reject..." (the
  // explicit ask). All three stay TEAM-limited by resolveDataScope, not by
  // being narrower permission strings.
  const MANAGER_PERMS = ["employee.view", "leave.view", "leave.approve", "leave.apply.onBehalf"];
  const SUPER_ADMIN_PERMS = PERMISSION_KEYS;

  const ROLES = [
    { code: "SUPER_ADMIN", name: "Super Admin", permissions: SUPER_ADMIN_PERMS },
    { code: "HR_ADMIN", name: "HR Admin", permissions: HR_ADMIN_PERMS },
    { code: "HR_EXECUTIVE", name: "HR Executive", permissions: HR_EXECUTIVE_PERMS },
    { code: "PAYROLL_ADMIN", name: "Payroll Admin", permissions: PAYROLL_ADMIN_PERMS },
    { code: "MANAGER", name: "Manager", permissions: MANAGER_PERMS },
    { code: "APPROVER", name: "Approver", permissions: ["leave.approve", "leave.view"] }, // Phase 4 — more
    // permissions arrive with Phase 6 (payroll maker-checker)
    { code: "EMPLOYEE", name: "Employee", permissions: [] as string[] },
  ];

  const roles: Record<string, { id: string }> = {};
  for (const r of ROLES) {
    const role = await prisma.role.create({ data: { code: r.code, name: r.name } });
    roles[r.code] = role;
    await prisma.rolePermission.createMany({
      data: r.permissions.map((key) => ({ roleId: role.id, permissionId: perm[key]!.id })),
    });
  }

  // ── Employees ────────────────────────────────────────────────────────
  // Device-ID reuse fixture first: a separated employee who used to hold
  // device user ID "1090". Adding a new hire with 1090 in the wizard
  // should surface the collision message + "1090-2" suggestion.
  const reuseFixtureCode = "1090";

  const specs: EmployeeSpec[] = [
    // Leadership / admin accounts
    {
      employeeCode: "1000",
      deviceUserId: "1000",
      fullName: "Aditi Sharma",
      gender: "FEMALE",
      dob: "1988-04-12",
      doj: "2022-01-10",
      employmentType: "PERMANENT",
      deptCode: "ADMIN",
      designationCode: "DIR",
      gradeCode: "G6",
      costCentreCode: "CC-ADMIN",
      locationCode: "PAN-C10",
      account: "active",
    },
    {
      employeeCode: "1001",
      deviceUserId: "1001",
      fullName: "Rohan Mehta",
      gender: "MALE",
      dob: "1985-09-03",
      doj: "2022-02-01",
      employmentType: "PERMANENT",
      deptCode: "HR",
      designationCode: "ASSOC_DIR",
      gradeCode: "G5",
      costCentreCode: "CC-HR",
      locationCode: "PAN-C10",
      managerCode: "1000",
      account: "active",
    },
    // Managers
    {
      employeeCode: "1002",
      deviceUserId: "1002",
      fullName: "Karan Kapoor",
      gender: "MALE",
      dob: "1986-11-20",
      doj: "2021-06-15",
      employmentType: "PERMANENT",
      deptCode: "ENG",
      designationCode: "SR_MGR",
      gradeCode: "G4",
      costCentreCode: "CC-ENG",
      locationCode: "PAN-C10",
      managerCode: "1000",
      account: "active",
    },
    {
      employeeCode: "1003",
      deviceUserId: "1003",
      fullName: "Priya Nair",
      gender: "FEMALE",
      dob: "1987-02-18",
      doj: "2021-08-01",
      employmentType: "PERMANENT",
      deptCode: "SALES",
      designationCode: "SR_MGR",
      gradeCode: "G4",
      costCentreCode: "CC-SALES",
      locationCode: "PAN-SPN",
      managerCode: "1000",
      account: "active",
    },
    {
      employeeCode: "1004",
      deviceUserId: "1004",
      fullName: "Vikram Rao",
      gender: "MALE",
      dob: "1984-07-09",
      doj: "2020-11-01",
      employmentType: "PERMANENT",
      deptCode: "OPS",
      designationCode: "MGR",
      gradeCode: "G3",
      costCentreCode: "CC-OPS",
      locationCode: "AJM-1",
      managerCode: "1000",
      account: "active",
    },
    {
      employeeCode: "1005",
      deviceUserId: "1005",
      fullName: "Neha Verma",
      gender: "FEMALE",
      dob: "1989-03-27",
      doj: "2022-04-18",
      employmentType: "PERMANENT",
      deptCode: "FIN",
      designationCode: "MGR",
      gradeCode: "G3",
      costCentreCode: "CC-FIN",
      locationCode: "PAN-B22",
      managerCode: "1001",
      account: "active",
    },
    // Individual contributors — mostly ACTIVE (known password) so grids
    // have plenty of browsable content, with a deliberate handful in
    // other states to prove those UI states render correctly.
    { employeeCode: "1006", deviceUserId: "1006", fullName: "Arjun Singh", gender: "MALE", dob: "1993-05-14", doj: "2023-01-09", employmentType: "PERMANENT", deptCode: "ENG", designationCode: "SR_EXEC", gradeCode: "G2", costCentreCode: "CC-ENG", locationCode: "PAN-C10", managerCode: "1002", account: "active" },
    { employeeCode: "1007", deviceUserId: "1007", fullName: "Kavya Iyer", gender: "FEMALE", dob: "1994-08-22", doj: "2023-02-20", employmentType: "PERMANENT", deptCode: "ENG", designationCode: "EXEC", gradeCode: "G1", costCentreCode: "CC-ENG", locationCode: "PAN-C10", managerCode: "1002", account: "active" },
    { employeeCode: "1008", deviceUserId: "1008", fullName: "Aditya Joshi", gender: "MALE", dob: "1991-12-05", doj: "2022-09-12", employmentType: "PERMANENT", deptCode: "ENG", designationCode: "ASST_MGR", gradeCode: "G2", costCentreCode: "CC-ENG", locationCode: "PAN-SPN", managerCode: "1002", account: "active" },
    { employeeCode: "1009", deviceUserId: "1009", fullName: "Ananya Agarwal", gender: "FEMALE", dob: "1995-01-30", doj: "2024-03-04", employmentType: "PERMANENT", deptCode: "ENG", designationCode: "EXEC", gradeCode: "G1", costCentreCode: "CC-ENG", locationCode: "AJM-1", managerCode: "1002", account: "invited" },
    { employeeCode: "1010", deviceUserId: "1010", fullName: "Rahul Malhotra", gender: "MALE", dob: "1990-06-17", doj: "2021-10-25", employmentType: "PERMANENT", deptCode: "SALES", designationCode: "SR_EXEC", gradeCode: "G2", costCentreCode: "CC-SALES", locationCode: "PAN-SPN", managerCode: "1003", account: "active" },
    { employeeCode: "1011", deviceUserId: "1011", fullName: "Divya Chauhan", gender: "FEMALE", dob: "1992-10-11", doj: "2022-12-01", employmentType: "PERMANENT", deptCode: "SALES", designationCode: "EXEC", gradeCode: "G1", costCentreCode: "CC-SALES", locationCode: "AJM-2", managerCode: "1003", account: "active" },
    { employeeCode: "1012", deviceUserId: "1012", fullName: "Sanjay Bhatt", gender: "MALE", dob: "1988-02-08", doj: "2020-05-19", employmentType: "CONTRACT", deptCode: "SALES", designationCode: "ASST_MGR", gradeCode: "G2", costCentreCode: "CC-SALES", locationCode: "PAN-B22", managerCode: "1003", account: "locked" },
    { employeeCode: "1013", deviceUserId: "1013", fullName: "Pooja Desai", gender: "FEMALE", dob: "1996-04-03", doj: "2024-06-10", employmentType: "PROBATION", deptCode: "SALES", designationCode: "EXEC", gradeCode: "G1", costCentreCode: "CC-SALES", locationCode: "AJM-3", managerCode: "1003", account: "invited" },
    { employeeCode: "1014", deviceUserId: "1014", fullName: "Nikhil Kulkarni", gender: "MALE", dob: "1989-09-25", doj: "2021-03-15", employmentType: "PERMANENT", deptCode: "OPS", designationCode: "SR_EXEC", gradeCode: "G2", costCentreCode: "CC-OPS", locationCode: "AJM-1", managerCode: "1004", account: "active" },
    { employeeCode: "1015", deviceUserId: "1015", fullName: "Sneha Pillai", gender: "FEMALE", dob: "1993-11-19", doj: "2022-07-07", employmentType: "PERMANENT", deptCode: "OPS", designationCode: "EXEC", gradeCode: "G1", costCentreCode: "CC-OPS", locationCode: "AJM-1", managerCode: "1004", account: "active" },
    { employeeCode: "1016", deviceUserId: "1016", fullName: "Amit Chatterjee", gender: "MALE", dob: "1987-01-28", doj: "2020-08-03", employmentType: "PERMANENT", deptCode: "OPS", designationCode: "ASST_MGR", gradeCode: "G2", costCentreCode: "CC-OPS", locationCode: "AJM-2", managerCode: "1004", account: "active" },
    { employeeCode: "1017", deviceUserId: "1017", fullName: "Ritu Bose", gender: "FEMALE", dob: "1994-05-06", doj: "2023-09-18", employmentType: "PERMANENT", deptCode: "OPS", designationCode: "EXEC", gradeCode: "G1", costCentreCode: "CC-OPS", locationCode: "AJM-3", managerCode: "1004", account: "invited" },
    { employeeCode: "1018", deviceUserId: "1018", fullName: "Deepak Reddy", gender: "MALE", dob: "1990-03-21", doj: "2021-11-11", employmentType: "PERMANENT", deptCode: "FIN", designationCode: "SR_EXEC", gradeCode: "G2", costCentreCode: "CC-FIN", locationCode: "PAN-B22", managerCode: "1005", account: "active" },
    { employeeCode: "1019", deviceUserId: "1019", fullName: "Meera Gupta", gender: "FEMALE", dob: "1991-07-14", doj: "2022-05-23", employmentType: "PERMANENT", deptCode: "FIN", designationCode: "EXEC", gradeCode: "G1", costCentreCode: "CC-FIN", locationCode: "PAN-B22", managerCode: "1005", account: "active" },
    { employeeCode: "1020", deviceUserId: "1020", fullName: "Suresh Iyer", gender: "MALE", dob: "1986-12-02", doj: "2020-02-14", employmentType: "PERMANENT", deptCode: "FIN", designationCode: "ASST_MGR", gradeCode: "G2", costCentreCode: "CC-FIN", locationCode: "PAN-C10", managerCode: "1005", account: "active" },
    { employeeCode: "1021", deviceUserId: "1021", fullName: "Swati Rao", gender: "FEMALE", dob: "1995-09-09", doj: "2024-01-22", employmentType: "PERMANENT", deptCode: "HR", designationCode: "SR_EXEC", gradeCode: "G2", costCentreCode: "CC-HR", locationCode: "PAN-C10", managerCode: "1001", account: "active" },
    { employeeCode: "1022", deviceUserId: "1022", fullName: "Manoj Nair", gender: "MALE", dob: "1992-04-16", doj: "2023-06-05", employmentType: "PERMANENT", deptCode: "HR", designationCode: "EXEC", gradeCode: "G1", costCentreCode: "CC-HR", locationCode: "PAN-C10", managerCode: "1001", account: "active" },
    { employeeCode: "1023", deviceUserId: "1023", fullName: "Kirti Malhotra", gender: "FEMALE", dob: "1997-08-30", doj: "2024-08-01", employmentType: "INTERN", deptCode: "HR", designationCode: "EXEC", gradeCode: "G1", costCentreCode: "CC-HR", locationCode: "PAN-C10", managerCode: "1001", account: "invited" },
    { employeeCode: "1024", deviceUserId: "1024", fullName: "Rajesh Kumar", gender: "MALE", dob: "1983-06-25", doj: "2019-04-08", employmentType: "PERMANENT", deptCode: "ADMIN", designationCode: "MGR", gradeCode: "G3", costCentreCode: "CC-ADMIN", locationCode: "PAN-C10", managerCode: "1000", account: "active" },
    { employeeCode: "1025", deviceUserId: "1025", fullName: "Anjali Desai", gender: "FEMALE", dob: "1996-02-11", doj: "2024-07-15", employmentType: "CONSULTANT", deptCode: "ADMIN", designationCode: "EXEC", gradeCode: "G1", costCentreCode: "CC-ADMIN", locationCode: "PAN-B22", managerCode: "1024", account: "active" },
    { employeeCode: "1026", deviceUserId: "1026", fullName: "Anil Chauhan", gender: "MALE", dob: "1989-10-04", doj: "2021-01-20", employmentType: "PERMANENT", deptCode: "ENG", designationCode: "SR_EXEC", gradeCode: "G2", costCentreCode: "CC-ENG", locationCode: "AJM-2", managerCode: "1002", account: "active" },
    { employeeCode: "1027", deviceUserId: "1027", fullName: "Shreya Bhatt", gender: "FEMALE", dob: "1993-03-08", doj: "2022-10-30", employmentType: "PERMANENT", deptCode: "SALES", designationCode: "SR_EXEC", gradeCode: "G2", costCentreCode: "CC-SALES", locationCode: "AJM-3", managerCode: "1003", account: "active" },
    // Rejoin-friendly separated employee still on record (not the device
    // reuse fixture below).
    { employeeCode: "1028", deviceUserId: "1028", fullName: "Vikas Pillai", gender: "MALE", dob: "1990-01-01", doj: "2019-09-01", employmentType: "PERMANENT", deptCode: "OPS", designationCode: "SR_EXEC", gradeCode: "G2", costCentreCode: "CC-OPS", locationCode: "AJM-1", managerCode: "1004", account: "separated", lastWorkingDate: "2025-05-31" },
    // Device-ID reuse fixture — separated, freeing device user ID 1090.
    {
      employeeCode: reuseFixtureCode,
      deviceUserId: reuseFixtureCode,
      fullName: "Gaurav Singh",
      gender: "MALE",
      dob: "1988-08-08",
      doj: "2018-03-12",
      employmentType: "PERMANENT",
      deptCode: "ENG",
      designationCode: "MGR",
      gradeCode: "G3",
      costCentreCode: "CC-ENG",
      locationCode: "PAN-C10",
      managerCode: "1000",
      account: "separated",
      lastWorkingDate: "2026-02-28",
    },
  ];

  const employeeIdByCode: Record<string, string> = {};
  const passwordHash = await argon2.hash(DEV_PASSWORD);
  // Every created_by_user_id below is a User.id, not an Employee.id — the
  // seed script acts as the Super Admin bootstrapping the whole system, so
  // once her own User row exists, everything (including her own historical
  // rows, created moments earlier) is attributed to her.
  let superAdminUserId: string | undefined;

  let n = 0;
  for (const spec of specs) {
    n += 1;

    const employee = await prisma.employee.create({
      data: {
        employeeCode: spec.employeeCode,
        officialEmail: `${spec.fullName.toLowerCase().replace(/\s+/g, ".")}@wellsure.com`,
        dateOfJoining: new Date(spec.doj),
        lastWorkingDate: spec.lastWorkingDate ? new Date(spec.lastWorkingDate) : null,
        employmentType: spec.employmentType,
        status: spec.account === "separated" ? "SEPARATED" : "ACTIVE",
      },
    });
    employeeIdByCode[spec.employeeCode] = employee.id;

    const roleCode =
      spec.employeeCode === "1000"
        ? "SUPER_ADMIN"
        : spec.employeeCode === "1001"
          ? "HR_ADMIN"
          : ["1002", "1003", "1004", "1005"].includes(spec.employeeCode)
            ? "MANAGER"
            : "EMPLOYEE";

    const user = await prisma.user.create({
      data: {
        employeeId: employee.id,
        status: spec.account === "invited" ? "INVITED" : spec.account === "separated" ? "DEACTIVATED" : "ACTIVE",
        passwordHash: spec.account === "invited" ? null : passwordHash,
        lockedUntil: spec.account === "locked" ? new Date(Date.now() + 15 * 60 * 1000) : null,
        failedLoginAttempts: spec.account === "locked" ? 5 : 0,
        privacyNoticeAcceptedAt: spec.account === "invited" ? null : new Date(),
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: roles[roleCode]!.id } });
    if (spec.employeeCode === "1000") {
      superAdminUserId = user.id;
    }
    const createdByUserId = superAdminUserId ?? user.id;

    await prisma.employeePersonal.create({
      data: {
        employeeId: employee.id,
        dateOfBirth: new Date(spec.dob),
        gender: spec.gender,
        personalEmail: `${spec.fullName.toLowerCase().replace(/\s+/g, ".")}${n}@gmail.com`,
        mobile: `9${String(800000000 + n * 97).slice(0, 9)}`,
        currentAddress: `${spec.fullName.split(" ")[0]}'s current address, ${loc[spec.locationCode]!.city}`,
        permanentAddress: `${spec.fullName.split(" ")[0]}'s permanent address, ${loc[spec.locationCode]!.city}`,
        emergencyContactName: "Emergency Contact",
        emergencyContactPhone: `9${String(700000000 + n * 53).slice(0, 9)}`,
        emergencyContactRelation: "Spouse",
        bloodGroup: ["O+", "A+", "B+", "AB+"][n % 4],
      },
    });

    await prisma.employeeNameHistory.create({
      data: {
        employeeId: employee.id,
        fullName: spec.fullName,
        effectiveFrom: new Date(spec.doj),
        createdByUserId,
      },
    });

    const managerId = spec.managerCode ? employeeIdByCode[spec.managerCode] : undefined;
    await prisma.employeeJobHistory.create({
      data: {
        employeeId: employee.id,
        departmentId: dept[spec.deptCode]!.id,
        designationId: desig[spec.designationCode]!.id,
        locationId: loc[spec.locationCode]!.id,
        gradeId: grade[spec.gradeCode]!.id,
        costCentreId: cc[spec.costCentreCode]!.id,
        reportingManagerId: managerId ?? null,
        effectiveFrom: new Date(spec.doj),
        createdByUserId,
      },
    });

    await prisma.deviceUserMapping.create({
      data: {
        employeeId: employee.id,
        deviceUserId: spec.deviceUserId,
        validFrom: new Date(spec.doj),
        validTo: spec.lastWorkingDate ? new Date(spec.lastWorkingDate) : null,
        createdByUserId,
      },
    });

    const pan = fakePan(n);
    const aadhaar = fakeAadhaar(n);
    const uan = fakeUan(n);
    await prisma.employeeStatutory.create({
      data: {
        employeeId: employee.id,
        panEncrypted: encryptField(pan),
        panLast4: pan.slice(-4),
        panHash: blindIndex(normalizePan(pan)),
        aadhaarEncrypted: encryptField(aadhaar),
        aadhaarLast4: aadhaar.slice(-4),
        aadhaarHash: blindIndex(normalizeAadhaar(aadhaar)),
        uanEncrypted: encryptField(uan),
        uanLast4: uan.slice(-4),
      },
    });

    const accountNumber = fakeAccountNumber(n);
    const bank = IFSC_BANKS[n % IFSC_BANKS.length]!;
    await prisma.employeeBankAccount.create({
      data: {
        employeeId: employee.id,
        accountHolderName: spec.fullName,
        accountNumberEncrypted: encryptField(accountNumber),
        accountNumberLast4: accountNumber.slice(-4),
        accountNumberHash: blindIndex(normalizeAccountNumber(accountNumber)),
        ifsc: bank.ifsc,
        bankName: bank.bankName,
        branchName: `${loc[spec.locationCode]!.city} Branch`,
        effectiveFrom: new Date(spec.doj),
        createdByUserId,
      },
    });
  }

  // ── System Settings (spec §7.8) — explicit rows so the Settings screen
  // shows real, seeded values on first load rather than only the code's
  // hardcoded fallbacks (which getSetting() would silently use for an
  // unseeded key, but a fresh install should have something to look at
  // and edit). ─────────────────────────────────────────────────────────
  const SETTINGS: Array<[string, unknown]> = [
    ["auth.lockout", { maxAttempts: 5, lockoutMinutes: 15 }],
    ["auth.passwordMinLength", 8],
    ["auth.invitationTtlHours", 48],
    ["auth.require2faRoles", []], // temporarily disabled fleet-wide — see chore commit 7f99cfd
    ["auth.rateLimit.login", { maxAttempts: 10, windowSeconds: 900 }],
    ["auth.rateLimit.totpVerify", { maxAttempts: 10, windowSeconds: 900 }],
    ["auth.rateLimit.inviteAccept", { maxAttempts: 10, windowSeconds: 900 }],
    ["auth.rateLimit.forgotPassword", { maxAttempts: 5, windowSeconds: 3600 }],
    ["auth.rateLimit.resetPassword", { maxAttempts: 10, windowSeconds: 900 }],
  ];
  for (const [key, value] of SETTINGS) {
    await prisma.systemSetting.create({ data: { key, value: value as Prisma.InputJsonValue, updatedByUserId: superAdminUserId } });
  }

  // ── Import Center history fixture (spec §10) — one already-committed
  // batch so the "Recent uploads" list isn't empty on a fresh install. ──
  const importBatch = await prisma.importBatch.create({
    data: {
      dataset: "ORG_MASTERS",
      fileName: "org-masters-initial-load.xlsx",
      status: "COMMITTED",
      totalRows: locations.length + departments.length,
      validRows: locations.length + departments.length,
      errorRows: 0,
      uploadedByUserId: superAdminUserId!,
      uploadedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      committedByUserId: superAdminUserId,
      committedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000),
    },
  });

  // ── Audit log fixture — a handful of realistic entries so the Audit Log
  // viewer has something to filter/browse on a fresh install. The seed
  // script itself writes employees directly via Prisma (not through the
  // service layer's writeAuditLog() calls, which are for live traffic), so
  // without this the table would otherwise be completely empty until HR
  // clicks around for the first time. ─────────────────────────────────
  const now = Date.now();
  const hrAdminUser = await prisma.user.findUnique({ where: { employeeId: employeeIdByCode["1001"]! } });
  const AUDIT_ENTRIES: Array<{ actorUserId: string | null; action: string; entityType: string; entityId: string; after?: unknown; minutesAgo: number }> = [
    { actorUserId: superAdminUserId!, action: "import.committed", entityType: "ImportBatch", entityId: importBatch.id, after: { dataset: "ORG_MASTERS", rowCount: importBatch.totalRows }, minutesAgo: 30 * 24 * 60 },
    { actorUserId: superAdminUserId!, action: "employee.created", entityType: "Employee", entityId: employeeIdByCode["1024"]!, after: { employeeCode: "1024", fullName: "Rajesh Kumar" }, minutesAgo: 20 * 24 * 60 },
    { actorUserId: superAdminUserId!, action: "org.location.merged", entityType: "Location", entityId: loc["PAN-C10"]!.id, after: { mergedFrom: "C-10 Panchsheeel" }, minutesAgo: 18 * 24 * 60 },
    { actorUserId: superAdminUserId!, action: "employee.separation.initiated", entityType: "Employee", entityId: employeeIdByCode[reuseFixtureCode]!, after: { reason: "Resignation" }, minutesAgo: 10 * 24 * 60 },
    { actorUserId: superAdminUserId!, action: "settings.updated", entityType: "SystemSetting", entityId: "security", after: { lockoutMaxAttempts: 5 }, minutesAgo: 5 * 24 * 60 },
    { actorUserId: hrAdminUser?.id ?? null, action: "employee.export", entityType: "Employee", entityId: "grid", after: { rowCount: n, includeSensitive: false }, minutesAgo: 2 * 24 * 60 },
    { actorUserId: superAdminUserId!, action: "auth.login.success", entityType: "User", entityId: superAdminUserId!, minutesAgo: 60 },
  ];
  for (const entry of AUDIT_ENTRIES) {
    await prisma.auditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        after: entry.after as Prisma.InputJsonValue | undefined,
        createdAt: new Date(now - entry.minutesAgo * 60 * 1000),
      },
    });
  }

  console.log(`Seeded ${n} employees across ${locations.length} branches in 2 cities.`);
  console.log(`Dev login: Employee Code 1000 (Super Admin) or 1001 (HR Admin), password "${DEV_PASSWORD}".`);
  console.log(`Device-ID reuse fixture: employee code/device ID ${reuseFixtureCode} (Gaurav Singh, separated).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
