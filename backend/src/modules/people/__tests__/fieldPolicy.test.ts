import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DIRECTORY_TOGGLEABLE_FIELDS, type DirectoryToggleableField } from "@shared/constants/peopleDocuments";
import { prisma } from "../../../lib/prisma";
import { PEOPLE_DOCUMENTS_SETTING_KEYS } from "../../../lib/peopleDocumentsSettings";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { DIRECTORY_FIELD_POLICY, DIRECTORY_POLICY_MODELS } from "../fieldPolicy";
import { setSetting, snapshotPeopleDocumentsSettings } from "./peopleTestHelpers";

// Correction 5 of the approved commit C plan: a column added to
// EmployeePersonal (or Employee) must be explicitly classified for the
// People directory before the suite goes green again — the same idea as
// the cleanup guard (lib/__tests__/cleanup.test.ts).
describe("People directory field allowlist", () => {
  it("classifies every Employee and EmployeePersonal column, and nothing that no longer exists", () => {
    const problems: string[] = [];
    const columns = new Set<string>();
    for (const modelName of DIRECTORY_POLICY_MODELS) {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName)!;
      for (const field of model.fields) {
        if (field.kind === "object") continue; // relations aren't columns
        const key = `${modelName}.${field.name}`;
        columns.add(key);
        if (!DIRECTORY_FIELD_POLICY[key]) {
          problems.push(
            `${key} is not classified for the People directory. Add it to DIRECTORY_FIELD_POLICY in ` +
              `backend/src/modules/people/fieldPolicy.ts: { shown: "never", why: "…" } unless colleagues should ` +
              `see it — then { shown: "always" } or a System Settings toggle ({ shown: "setting", setting: … }, ` +
              `adding the toggle to DIRECTORY_TOGGLEABLE_FIELDS in shared/constants/peopleDocuments.ts), and ` +
              `project it in modules/people/directory.ts.`,
          );
        }
      }
    }
    for (const key of Object.keys(DIRECTORY_FIELD_POLICY)) {
      if (!columns.has(key)) problems.push(`DIRECTORY_FIELD_POLICY lists ${key}, which no longer exists — remove it.`);
    }
    expect(problems, `\n\n${problems.map((p) => `• ${p}`).join("\n\n")}\n`).toEqual([]);
  });

  describe("sentinel values never leak beyond what the policy and settings allow", () => {
    let org: TestOrgMasters;
    let subject: { employeeId: string; employeeCode: string };
    let viewerToken: string;
    let restoreSettings: () => Promise<void>;
    const viewerIds: string[] = [];
    const sentinels = new Map<string, string>(); // "Model.field" -> unique marker
    const SECRET_BIRTH_YEAR = "1937";

    beforeAll(async () => {
      restoreSettings = await snapshotPeopleDocumentsSettings();
      org = await createEmployeeTestOrgMasters();
      subject = await createFullTestEmployee(org);
      const viewer = await createFullTestEmployee(org);
      viewerIds.push(viewer.employeeId);
      viewerToken = await loginAs(viewer.employeeCode);

      // A unique marker in every text column of EmployeePersonal — whatever
      // columns exist now or are added later — plus Employee.officialEmail.
      const personalModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "EmployeePersonal")!;
      const personalData: Record<string, string> = {};
      for (const field of personalModel.fields) {
        if (field.kind !== "scalar" || field.type !== "String" || field.name === "id" || field.name === "employeeId") continue;
        const marker = `sentinel${field.name}${randomUUID().slice(0, 8)}`.toLowerCase();
        personalData[field.name] = marker;
        sentinels.set(`EmployeePersonal.${field.name}`, marker);
      }
      await prisma.employeePersonal.update({
        where: { employeeId: subject.employeeId },
        data: { ...personalData, dateOfBirth: new Date(`${SECRET_BIRTH_YEAR}-07-19`) },
      });
      const officialEmail = `sentinel.official.${randomUUID().slice(0, 8)}@example.com`;
      await prisma.employee.update({ where: { id: subject.employeeId }, data: { officialEmail } });
      sentinels.set("Employee.officialEmail", officialEmail);
    });

    afterAll(async () => {
      await cleanupFullTestEmployee(subject.employeeId);
      for (const id of viewerIds) await cleanupFullTestEmployee(id);
      await cleanupEmployeeTestOrgMasters(org);
      await restoreSettings();
    });

    async function everyResponseMentioningSubject(): Promise<string> {
      const bodies = await Promise.all([
        request(app).get(`/api/people/${subject.employeeId}`).set(...authHeader(viewerToken)),
        request(app).get("/api/people").query({ search: subject.employeeCode }).set(...authHeader(viewerToken)),
        request(app).get("/api/people/org-chart").set(...authHeader(viewerToken)),
      ]);
      for (const res of bodies) expect(res.status).toBe(200);
      return bodies.map((res) => JSON.stringify(res.body)).join("\n");
    }

    function expectOnlyAllowed(json: string, visible: Set<DirectoryToggleableField>) {
      const leaked: string[] = [];
      const missing: string[] = [];
      for (const [column, marker] of sentinels) {
        const policy = DIRECTORY_FIELD_POLICY[column]!;
        const allowed = policy.shown === "always" || (policy.shown === "setting" && visible.has(policy.setting));
        const present = json.toLowerCase().includes(marker);
        if (present && !allowed) leaked.push(column);
        if (!present && allowed) missing.push(column);
      }
      expect(leaked, "columns leaked into People responses").toEqual([]);
      expect(missing, "allowed columns missing from People responses").toEqual([]);
      expect(json).not.toContain(SECRET_BIRTH_YEAR); // birthday is day + month only, ever
    }

    it("with every toggle off, only always-shown columns appear", async () => {
      await setSetting(PEOPLE_DOCUMENTS_SETTING_KEYS.directoryVisibleFields, []);
      const json = await everyResponseMentioningSubject();
      expectOnlyAllowed(json, new Set());
      expect(json).not.toContain("07-19");
    });

    it("with every toggle on, exactly the toggled columns are added — and the birth year still never is", async () => {
      await setSetting(PEOPLE_DOCUMENTS_SETTING_KEYS.directoryVisibleFields, [...DIRECTORY_TOGGLEABLE_FIELDS]);
      const json = await everyResponseMentioningSubject();
      expectOnlyAllowed(json, new Set(DIRECTORY_TOGGLEABLE_FIELDS));
      expect(json).toContain('"birthday":"07-19"');
    });
  });
});
