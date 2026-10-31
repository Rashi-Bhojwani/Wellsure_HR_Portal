import { Prisma } from "@prisma/client";
import { storageService } from "../../integrations/storage";
import { prisma } from "../prisma";

// Schema-driven test cleanup.
//
// Three commits in a row (Phase 5 A and B, and the Phase 4 leave helpers
// before them) found the same bug: a new table FK-referencing Employee or
// User wasn't added to a hand-maintained cleanup helper, which surfaced
// later as a live FK violation on delete — or, worse, as a silent orphan
// when the FK was optional (Prisma's default onDelete for an optional
// relation is SetNull, which is how "null just joined us!" reached the
// real Engage feed). This module removes the hand-maintained list: it
// reads every relation from Prisma.dmmf and deletes a root row together
// with everything that depends on it, children first.
//
// The one decision the schema can't make for us is what an OPTIONAL
// foreign key means. Some optional FKs mean "this row belongs to that
// one" (an auto-post about an employee — delete it with them); others
// mean "this row merely points at that one" (a seeded SystemSetting last
// edited by a test user, or another employee whose reporting manager was
// a test fixture — null the pointer, keep the row). Every optional FK
// must therefore be classified in OPTIONAL_FK_POLICY below.
// cleanup.test.ts fails, naming the exact field, the moment a migration
// adds one that isn't — that is the guard against this bug class.

type Policy = "delete" | "setNull";

// Key: "<ChildModel>.<foreignKeyField>". Required FKs are never listed —
// a required FK can't be nulled, so its child is always deleted.
export const OPTIONAL_FK_POLICY: Record<string, Policy> = {
  // An incident belongs to the device or agent it records trouble with (exactly one is set, by a CHECK):
  // it disappears with it, never loses its subject.
  "DeviceIncident.deviceId": "delete",
  "DeviceIncident.agentId": "delete",
  // A token that replaced this one during refresh rotation — just a pointer.
  "RefreshToken.replacedByTokenId": "setNull",
  // Seeded settings can be edited by a test user; the setting must survive.
  "SystemSetting.updatedByUserId": "setNull",
  // A rejection recorded by a return file belongs to that read of the file.
  "BankRowRejection.importId": "delete",
  // A branch's optional city grouping — deleting a city never deletes branches.
  "Location.cityId": "setNull",
  // Grade/cost centre/manager are attributes of someone else's job row.
  "EmployeeJobHistory.gradeId": "setNull",
  "EmployeeJobHistory.costCentreId": "setNull",
  "EmployeeJobHistory.reportingManagerId": "setNull",
  // A CONSUMED ledger row drawn from a comp-off lot is meaningless without the lot.
  "LeaveLedger.compOffCreditId": "delete",
  // Nulling the scope would turn a scoped announcement into an org-wide one.
  "Announcement.scopeLocationId": "delete",
  "Announcement.scopeDepartmentId": "delete",
  // Same reasoning: a scoped company document must never become org-wide.
  "CompanyDocument.scopeLocationId": "delete",
  "CompanyDocument.scopeDepartmentId": "delete",
  // A ticket belongs to whoever raised it; the assignee is just a pointer.
  "HelpdeskTicket.assigneeEmployeeId": "setNull",
  "HelpdeskCategory.defaultAssigneeEmployeeId": "setNull",
  // An issued letter is its document (D2): deleting the document takes the
  // letter record with it, in tests only — the database itself refuses to
  // delete a letter's document while the letter exists (ON DELETE RESTRICT).
  "GeneratedLetter.employeeDocumentId": "delete",
  // A reissue stands on its own; losing the link to the original is fine.
  "GeneratedLetter.reissueOfId": "setNull",
  // Phase 2 ingestion. A test punch belongs to its test employee (deleted
  // through the raw_punches purge exception — see PURGE_GUARDED_MODELS).
  "RawPunch.employeeId": "delete",
  // A device or batch outlives the agent that once fed it — just a pointer.
  "Device.agentId": "setNull",
  "IngestionBatch.agentId": "setNull",
  // A manual entry from a muster upload goes with the upload (tests only:
  // both are append-only history in real use).
  "ManualAttendanceEntry.uploadId": "delete",
  // Phase 3: a bulk correction's batch is a grouping; a request survives it. An override made from a request goes with
  // it in tests (both are append-only history in real use, and an override must keep its request: a database CHECK).
  "RegularizationRequest.batchId": "setNull",
  "AttendanceOverride.requestId": "delete",
  "ShiftOverride.shiftId": "delete", // a shift override (a null shift is the "cleared" marker) belongs to the shift it names
  // Posts written by, or auto-posted about, an employee belong to them.
  "Post.authorEmployeeId": "delete",
  "Post.subjectEmployeeId": "delete",
  // Groups are categorisation only (see the Group schema comment).
  "Post.groupId": "setNull",
  // A salary row belongs to the revision that wrote it (tests only: a salary row is never deleted once it has started, and a revision never is).
  "EmployeeSalary.revisionId": "delete",
  // An adjustment only references the run that consumed it; it stays when a test removes the run.
  "PayrollAdjustment.consumedByRunId": "setNull",
};

// Every model must be cleanable from somewhere. Most are reached as a
// dependent of Employee (every per-employee fixture's root) or of User.
// The rest are standalone masters/configuration rows that tests create
// and remove directly — via deleteWithDependents(<model>, ids), which
// takes their dependents with them, or (for the id-less singletons) a
// plain deleteMany on their natural key.
export const FIXTURE_ROOT_MODELS = ["Employee", "User"] as const;
export const STANDALONE_ROOT_MODELS: Record<string, string> = {
  Role: "shared role catalog; cleanupTestRole",
  Permission: "shared permission catalog; cleanupTestData({ permissionIds })",
  Company: "single seeded company row; never created by tests",
  City: "org master; cleanupEmployeeTestOrgMasters",
  Location: "org master; cleanupTestData / cleanupEmployeeTestOrgMasters",
  Department: "org master; cleanupTestData / cleanupEmployeeTestOrgMasters",
  Designation: "org master; cleanupTestData / cleanupEmployeeTestOrgMasters",
  Grade: "org master; cleanupEmployeeTestOrgMasters",
  CostCentre: "org master; cleanupEmployeeTestOrgMasters",
  SystemSetting: "id-less singleton keyed by `key`; tests snapshot and restore it",
  RegularizationBatch: "groups a bulk correction; tests delete it by id after its requests",
  AttendancePeriodLock: "the append-only record of finalising and unlocking an attendance cycle; keyed by dates, no employee",
  PayrollItemVersion: "append-only payroll rule/component/structure/template versions (Phase 6); keyed by kind+key, no employee; removed by test key through purgeAppendOnly",
  PayrollSetupSignoff: "append-only sign-offs that a class of people's data was checked (P6-6); no employee; removed by test key through purgeAppendOnly",
  PayrollItemConfirmation: "append-only confirmations of payroll item versions (Phase 6); no employee; removed by test key through purgeAppendOnly",
  PayrollApproval: "the maker-checker core (Phase 6); actor columns are plain text, no FKs; removed by test subject id through purgeAppendOnly",
  PayrollEvent: "append-only payroll event record (Phase 6); no FKs; removed by test subject id through purgeAppendOnly",
  PayrollRun: "a payroll run (Phase 6 P6-3); user columns are plain text, no employee FK; tests delete it by createdByUserId (its items and lines go with it)",
  PayrollSalaryRevision: "a salary change as a unit (Phase 6 P6-2); user columns are plain text, no employee FK; tests delete it by createdByUserId (its salary rows go with it)",
  ImportBatch: "import upload batch; tests delete it by id (staging rows cascade)",
  LeaveType: "leave catalog; tests delete by id",
  Holiday: "company-wide holiday list; tests delete by id",
  RestrictedHoliday: "company-wide RH list; tests delete by id",
  YearEndRun: "year-end run; tests delete by id (items cascade)",
  Announcement: "HR announcement; tests delete by id",
  Group: "Engage group; cleanupEngageGroups",
  LetterTemplate: "letter template master; deleteWithDependents(\"LetterTemplate\", ids) takes its versions and issued letters with it",
  HelpdeskCategory: "helpdesk category master; deleteWithDependents(\"HelpdeskCategory\", ids) takes its tickets with it",
  DocumentCategory: "document category master; deleteWithDependents(\"DocumentCategory\", ids) takes its documents with it",
  EngageAutoPostSetting: "id-less closed catalog keyed by `kind`; cleanupAutoPostSetting",
  AuditLog: "append-only (E1.1); no FKs — rows about a fixture go via deleteEmployeesAndDependents, through purgeAppendOnly",
  PayrollSalaryHold: "a director's hold on one person's salary for one month (Stage 3.3c); append-only, employee_id and the actor are plain text; tests remove the holds their directors made by id, in cleanupPayrollRowsBy",
  RemoteWorkMark: "a director's mark of who works remotely, from a date (Stage 5a); append-only, employee_id and the actor are plain text; tests remove the marks their directors made, by id",
  BankReturnImport: "a bank return file read for a batch (Stage 5b); append-only, removed with its batch in tests by the batch id",
  PayrollMonthlyInput: "one entry of one monthly figure (Stage 4); append-only, employee_id and the actor are plain text; tests remove the rows their directors made, in cleanupPayrollRowsBy",
  PayrollInputBatch: "an uploaded Monthly Inputs file after it was read (Stage 4); a plain-text actor; tests remove the batches their directors made, in cleanupPayrollRowsBy",
  PayrollSalaryRelease: "the release of a salary hold (Stage 3.3c); append-only, a plain-text actor; removed with its hold in cleanupPayrollRowsBy",
  HrCapabilitySwitch: "the append-only record of what a director switched on or off for HR (Stage 1); subject_key is a role code or a user id as plain text, no FKs; tests remove their own rows by id through purgeAppendOnly",
  RolePermissionRemoval: "the append-only record of the pay keys the HR hard-lock migration removed from the HR roles (Stage 1); no FKs; only the one test that proves it is append-only writes to it, and the test database is rebuilt each run",
  DirectorActionNotice: "what a director's own-authority act tells the other director (D1); user columns are plain text, no FKs to users; its receipts go with it; removed by id through purgeAppendOnly",
  SecurityEvent: "append-only (E1.1); no FKs — tests remove their own rows by id through purgeAppendOnly",
  DevDatabaseMarker: "one row written by the dev seed (E1.1); never created or removed by tests",
  BiometricAgent: "sync agent (Phase 2); deleteWithDependents(\"BiometricAgent\", ids)",
  AttendanceProcessRun: "Process Attendance run (Phase 2); deleteWithDependents(\"AttendanceProcessRun\", ids)",
  Device: "biometric device (Phase 2); deleteWithDependents(\"Device\", ids) takes its batches and punches with it",
  Shift: "attendance config master (Phase 2); deleteWithDependents(\"Shift\", ids) takes its sessions and assignments with it",
  WeekOffPattern: "attendance config master (Phase 2); deleteWithDependents(\"WeekOffPattern\", ids)",
  AttendancePolicy: "attendance config master (Phase 2); deleteWithDependents(\"AttendancePolicy\", ids)",
  AttendanceCycleRule: "attendance cycle rules (Phase 2); deleteWithDependents(\"AttendanceCycleRule\", ids)",
};

// Columns holding a StorageService key. When the engine deletes a row it
// also deletes the stored object, so tests that upload files don't leave
// them behind in .storage/. The guard fails on any column that looks like a
// storage key (…StorageKey / fileKey) but isn't listed here.
export const STORAGE_KEY_COLUMNS: Record<string, string[]> = {
  EmployeePersonal: ["photoStorageKey", "photoThumbStorageKey"],
  EmployeeDocument: ["fileKey"],
  CompanyDocument: ["fileKey"],
  HelpdeskAttachment: ["fileKey"],
  YearEndRun: ["reportStorageKey"],
  LeaveRequest: ["attachmentStorageKey"],
  Company: ["logoStorageKey"],
  // Phase 6 P6-5: the rendered payslip PDF, the bank file and the bank's response to it, and a generated statutory file.
  PayslipDelivery: ["fileKey"],
  BankTransferBatch: ["fileKey", "responseKey"],
  BankRepaymentBatch: ["fileKey"],
  PayrollOutput: ["fileKey"],
};
const STORAGE_KEY_COLUMN_PATTERN = /(StorageKey|^fileKey|^storageKey)$/;

interface Edge {
  parent: string;
  child: string;
  fk: string;
  optional: boolean;
  action: Policy;
}

const models = Prisma.dmmf.datamodel.models;
const modelByName = new Map(models.map((m) => [m.name, m]));

function hasIdField(modelName: string): boolean {
  return modelByName.get(modelName)?.fields.some((f) => f.isId && f.name === "id") ?? false;
}

function buildEdges(): Edge[] {
  const edges: Edge[] = [];
  for (const model of models) {
    for (const field of model.fields) {
      if (field.kind !== "object" || !field.relationFromFields?.length) continue;
      const fk = field.relationFromFields[0]!;
      const optional = !field.isRequired;
      const action: Policy = optional ? (OPTIONAL_FK_POLICY[`${model.name}.${fk}`] ?? "delete") : "delete";
      edges.push({ parent: field.type, child: model.name, fk, optional, action });
    }
  }
  return edges;
}

const edges = buildEdges();

// Everything the engine assumes about the schema, checked in one place.
// Returns one human-readable, actionable message per problem; empty means
// the engine can clean every model correctly. cleanup.test.ts asserts it's
// empty, so a migration that breaks an assumption fails the suite with
// the fix spelled out rather than an FK error three commits later.
export function findCleanupSchemaProblems(): string[] {
  const problems: string[] = [];
  const policyHelp =
    `add it to OPTIONAL_FK_POLICY in backend/src/lib/__tests__/cleanup.ts: "delete" if the row belongs to the ` +
    `row it points at (it should disappear with it, e.g. Post.subjectEmployeeId), or "setNull" if it merely ` +
    `references it (the row must survive, e.g. SystemSetting.updatedByUserId).`;

  for (const model of models) {
    for (const field of model.fields) {
      if (field.kind !== "object" || !field.relationFromFields?.length) continue;
      const key = `${model.name}.${field.relationFromFields[0]}`;
      if (field.relationFromFields.length !== 1 || field.relationToFields?.join() !== "id") {
        problems.push(
          `${key} -> ${field.type}: the cleanup engine only follows single-column foreign keys to the parent's ` +
            `"id" field. Point the relation at ${field.type}.id, or extend buildEdges()/deleteWithDependents() ` +
            `in backend/src/lib/__tests__/cleanup.ts to handle composite or non-id keys.`,
        );
      }
      if (!field.isRequired && !(key in OPTIONAL_FK_POLICY)) {
        problems.push(`${key} -> ${field.type} is an optional foreign key with no cleanup policy — ${policyHelp}`);
      }
    }
  }

  const edgeKeys = new Set(edges.map((e) => `${e.child}.${e.fk}`));
  for (const key of Object.keys(OPTIONAL_FK_POLICY)) {
    const edge = edges.find((e) => `${e.child}.${e.fk}` === key);
    if (!edgeKeys.has(key) || !edge?.optional) {
      problems.push(
        `OPTIONAL_FK_POLICY lists "${key}", which is no longer an optional foreign key in schema.prisma — ` +
          `remove it from backend/src/lib/__tests__/cleanup.ts.`,
      );
    }
  }

  for (const edge of edges) {
    if (edge.action === "delete" && edge.parent === edge.child) {
      problems.push(
        `${edge.child}.${edge.fk} is a self-referencing foreign key with a "delete" policy; the engine can't ` +
          `order deletes within one table. Classify it "setNull" in OPTIONAL_FK_POLICY.`,
      );
    }
    if (edge.action === "delete" && !hasIdField(edge.parent)) {
      problems.push(
        `${edge.child}.${edge.fk} points at ${edge.parent}, which has no single "id" primary key, so the engine ` +
          `can't collect its dependents. Give ${edge.parent} an "id" column.`,
      );
    }
  }

  for (const model of models) {
    for (const field of model.fields) {
      if (field.kind !== "scalar" || !STORAGE_KEY_COLUMN_PATTERN.test(field.name)) continue;
      if (!STORAGE_KEY_COLUMNS[model.name]?.includes(field.name)) {
        problems.push(
          `${model.name}.${field.name} looks like a StorageService key but isn't in STORAGE_KEY_COLUMNS in ` +
            `backend/src/lib/__tests__/cleanup.ts — add it, so deleting a ${model.name} row in tests also deletes its stored file.`,
        );
      }
    }
  }
  for (const [modelName, columns] of Object.entries(STORAGE_KEY_COLUMNS)) {
    for (const column of columns) {
      if (!modelByName.get(modelName)?.fields.some((f) => f.name === column)) {
        problems.push(`STORAGE_KEY_COLUMNS lists ${modelName}.${column}, which no longer exists — remove it from backend/src/lib/__tests__/cleanup.ts.`);
      }
    }
  }

  try {
    deletionOrder();
  } catch (err) {
    problems.push((err as Error).message);
  }

  const reachable = new Set<string>();
  const queue = [...FIXTURE_ROOT_MODELS, ...Object.keys(STANDALONE_ROOT_MODELS)];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (reachable.has(name)) continue;
    reachable.add(name);
    for (const edge of edges) if (edge.parent === name && edge.action === "delete") queue.push(edge.child);
  }
  for (const model of models) {
    if (!reachable.has(model.name)) {
      problems.push(
        `Model ${model.name} is not cleaned by any test helper: it isn't a dependent of ` +
          `${FIXTURE_ROOT_MODELS.join("/")} (or of any standalone root) through a required or "delete"-policy ` +
          `foreign key. Either give it such a foreign key, or add it to STANDALONE_ROOT_MODELS in ` +
          `backend/src/lib/__tests__/cleanup.ts with a note saying how tests remove it.`,
      );
    }
  }
  for (const name of Object.keys(STANDALONE_ROOT_MODELS)) {
    if (!modelByName.has(name)) {
      problems.push(
        `STANDALONE_ROOT_MODELS lists "${name}", which no longer exists in schema.prisma — remove it from ` +
          `backend/src/lib/__tests__/cleanup.ts.`,
      );
    }
  }
  return problems;
}

// Children before parents, over "delete" edges only ("setNull" edges are
// nulled out before any delete runs, so they impose no order).
let cachedOrder: string[] | null = null;
function deletionOrder(): string[] {
  if (cachedOrder) return cachedOrder;
  const blockers = new Map<string, Set<string>>(); // parent -> children that must go first
  for (const m of models) blockers.set(m.name, new Set());
  for (const e of edges) if (e.action === "delete" && e.parent !== e.child) blockers.get(e.parent)!.add(e.child);

  const order: string[] = [];
  const done = new Set<string>();
  while (done.size < models.length) {
    const ready = models.filter((m) => !done.has(m.name) && [...blockers.get(m.name)!].every((c) => done.has(c)));
    if (ready.length === 0) {
      const stuck = models.filter((m) => !done.has(m.name)).map((m) => m.name);
      throw new Error(
        `Foreign keys among ${stuck.join(", ")} form a cycle the cleanup engine can't order. Classify one of ` +
          `the optional foreign keys in that cycle as "setNull" in OPTIONAL_FK_POLICY ` +
          `(backend/src/lib/__tests__/cleanup.ts).`,
      );
    }
    for (const m of ready) {
      done.add(m.name);
      order.push(m.name);
    }
  }
  cachedOrder = order;
  return order;
}

interface Delegate {
  findMany(args: { where: object; select: { id: true } }): Promise<{ id: string }[]>;
  deleteMany(args: { where: object }): Promise<unknown>;
  updateMany(args: { where: object; data: object }): Promise<unknown>;
}

function delegate(modelName: string): Delegate {
  const key = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  const found = (prisma as unknown as Record<string, Delegate | undefined>)[key];
  if (!found) throw new Error(`cleanup: no Prisma delegate "${key}" for model ${modelName}`);
  return found;
}

// Tables a database trigger keeps immutable, deletable only through the
// test-purge exception (app.audit_purge = 'test' in a dev-marked database).
const PURGE_GUARDED_MODELS = new Set(["RawPunch", "ManualAttendanceEntry", "AttendanceOverride", "ShiftOverride", "LeaveDayRelease", "AttendancePeriodLock", "PayrollItemVersion", "PayrollItemConfirmation", "PayrollApproval", "PayrollEvent", "EmployeeSalary", "EmployeeSalaryLine", "PayrollSalaryRevision", "PayrollAdjustment", "PayrollRun", "PayrollRunItem", "PayrollRunLine", "PayrollPeriodLock", "PayrollRunRelease", "Payslip", "BankTransferBatch", "BankTransferRow", "PayrollOutput", "PayrollSetupSignoff", "DirectorActionNotice", "DirectorActionReceipt", "RolePermissionRemoval", "HrCapabilitySwitch", "PayrollSalaryHold", "PayrollSalaryRelease", "PayrollMonthlyInput", "PayrollInputBatch", "RemoteWorkMark", "RemoteAttendanceEvent", "BankReturnImport", "BankRowRejection", "BankRepaymentPlan", "BankRepaymentBatch", "BankRepaymentRow", "PayslipLink"]);

// Deletes the given rows of `model` and every row that depends on them,
// transitively, in FK-safe order. Optional FKs follow OPTIONAL_FK_POLICY.
export async function deleteWithDependents(model: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (!modelByName.has(model)) throw new Error(`deleteWithDependents: unknown model ${model}`);

  const collected = new Map<string, Set<string>>();
  const idlessWheres = new Map<string, object[]>();
  const nullify: { child: string; fk: string; parentIds: string[] }[] = [];

  collected.set(model, new Set(ids));
  const queue: { model: string; ids: string[] }[] = [{ model, ids }];
  while (queue.length > 0) {
    const { model: parent, ids: parentIds } = queue.shift()!;
    for (const edge of edges) {
      if (edge.parent !== parent) continue;
      const where = { [edge.fk]: { in: parentIds } };
      if (edge.action === "setNull") {
        nullify.push({ child: edge.child, fk: edge.fk, parentIds });
        continue;
      }
      if (!hasIdField(edge.child)) {
        idlessWheres.set(edge.child, [...(idlessWheres.get(edge.child) ?? []), where]);
        continue;
      }
      const rows = await delegate(edge.child).findMany({ where, select: { id: true } });
      const seen = collected.get(edge.child) ?? new Set<string>();
      collected.set(edge.child, seen);
      const fresh = rows.map((r) => r.id).filter((id) => !seen.has(id));
      fresh.forEach((id) => seen.add(id));
      if (fresh.length > 0) queue.push({ model: edge.child, ids: fresh });
    }
  }

  for (const { child, fk, parentIds } of nullify) {
    await delegate(child).updateMany({ where: { [fk]: { in: parentIds } }, data: { [fk]: null } });
  }
  // Stored files first, while the rows that name them still exist.
  for (const [name, idSet] of collected) {
    const columns = STORAGE_KEY_COLUMNS[name];
    if (!columns || idSet.size === 0) continue;
    const rows = await delegate(name).findMany({
      where: { id: { in: [...idSet] } },
      select: Object.fromEntries(columns.map((c) => [c, true])) as never,
    });
    for (const row of rows as unknown as Record<string, string | null>[]) {
      for (const column of columns) {
        const key = row[column];
        if (key) await storageService.deleteObject(key);
      }
    }
  }

  for (const name of deletionOrder()) {
    const idSet = collected.get(name);
    if (idSet && idSet.size > 0 && PURGE_GUARDED_MODELS.has(name)) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT set_config('app.audit_purge', 'test', true)");
        await (tx as unknown as Record<string, Delegate>)[name.charAt(0).toLowerCase() + name.slice(1)]!.deleteMany({ where: { id: { in: [...idSet] } } });
      });
    } else if (idSet && idSet.size > 0) await delegate(name).deleteMany({ where: { id: { in: [...idSet] } } });
    const wheres = idlessWheres.get(name);
    if (wheres) await delegate(name).deleteMany({ where: { OR: wheres } });
  }
}

// audit_logs and security_events are append-only at the database level
// (E1.1). The only way a test may remove its fixture rows is the trigger's
// test exception: app.audit_purge = 'test' for this transaction, honoured
// only in a database the dev seed marked (a row in dev_database_marker).
export async function purgeAppendOnly(model: "AuditLog" | "SecurityEvent" | "HrCapabilitySwitch" | "RolePermissionRemoval", where: object): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT set_config('app.audit_purge', 'test', true)");
    if (model === "AuditLog") await tx.auditLog.deleteMany({ where });
    else if (model === "HrCapabilitySwitch") await tx.hrCapabilitySwitch.deleteMany({ where });
    else if (model === "RolePermissionRemoval") await tx.rolePermissionRemoval.deleteMany({ where });
    else await tx.securityEvent.deleteMany({ where });
  });
}

// The one entry point every per-employee cleanup helper uses. AuditLog's
// entityId is a plain string (it can name any entity type), not an FK, so
// the engine can't see it — rows *about* the fixture are removed here
// explicitly, alongside rows *by* it (actorUserId, handled by the engine).
export async function deleteEmployeesAndDependents(employeeIds: string[]): Promise<void> {
  if (employeeIds.length === 0) return;
  const users = await prisma.user.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true } });
  const ids = [...employeeIds, ...users.map((u) => u.id)];
  await purgeAppendOnly("AuditLog", { OR: [{ entityId: { in: ids } }, { actorUserId: { in: users.map((u) => u.id) } }] });
  await deleteWithDependents("Employee", employeeIds);
}
