import { Prisma } from "@prisma/client";
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
  // A token that replaced this one during refresh rotation — just a pointer.
  "RefreshToken.replacedByTokenId": "setNull",
  // Audit rows written by a test actor are test noise.
  "AuditLog.actorUserId": "delete",
  // Seeded settings can be edited by a test user; the setting must survive.
  "SystemSetting.updatedByUserId": "setNull",
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
  // Posts written by, or auto-posted about, an employee belong to them.
  "Post.authorEmployeeId": "delete",
  "Post.subjectEmployeeId": "delete",
  // Groups are categorisation only (see the Group schema comment).
  "Post.groupId": "setNull",
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
  ImportBatch: "import upload batch; tests delete it by id (staging rows cascade)",
  LeaveType: "leave catalog; tests delete by id",
  Holiday: "company-wide holiday list; tests delete by id",
  RestrictedHoliday: "company-wide RH list; tests delete by id",
  YearEndRun: "year-end run; tests delete by id (items cascade)",
  Announcement: "HR announcement; tests delete by id",
  Group: "Engage group; cleanupEngageGroups",
  EngageAutoPostSetting: "id-less closed catalog keyed by `kind`; cleanupAutoPostSetting",
};

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
  for (const name of deletionOrder()) {
    const idSet = collected.get(name);
    if (idSet && idSet.size > 0) await delegate(name).deleteMany({ where: { id: { in: [...idSet] } } });
    const wheres = idlessWheres.get(name);
    if (wheres) await delegate(name).deleteMany({ where: { OR: wheres } });
  }
}

// The one entry point every per-employee cleanup helper uses. AuditLog's
// entityId is a plain string (it can name any entity type), not an FK, so
// the engine can't see it — rows *about* the fixture are removed here
// explicitly, alongside rows *by* it (actorUserId, handled by the engine).
export async function deleteEmployeesAndDependents(employeeIds: string[]): Promise<void> {
  if (employeeIds.length === 0) return;
  const users = await prisma.user.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...employeeIds, ...users.map((u) => u.id)] } } });
  await deleteWithDependents("Employee", employeeIds);
}
