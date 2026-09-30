import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../prisma";
import { deleteEmployeesAndDependents, deleteWithDependents, findCleanupSchemaProblems } from "./cleanup";
import {
  cleanupEmployeeTestOrgMasters,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  type TestOrgMasters,
} from "../../modules/employee/__tests__/employeeTestHelpers";

// Guard for the recurring "new table not added to test cleanup" bug class.
// The schema checks fail with a message naming the exact model/field and
// what to change in lib/__tests__/cleanup.ts — read it, it's the fix.
describe("schema-driven test cleanup", () => {
  it("every model and foreign key in schema.prisma is handled by the cleanup engine", () => {
    const problems = findCleanupSchemaProblems();
    expect(problems, `\n\n${problems.map((p) => `• ${p}`).join("\n\n")}\n`).toEqual([]);
  });

  describe("deleting an employee removes everything that belongs to them, and nothing that merely points at them", () => {
    const roleCode = `TEST_CLEANUP_${randomUUID().slice(0, 8)}`;
    const settingKey = `test.cleanup.${randomUUID().slice(0, 8)}`;
    let org: TestOrgMasters;
    let subject: { employeeId: string; userId: string };
    let report: { employeeId: string; userId: string };
    let colleague: { employeeId: string; userId: string };
    let colleaguePostId: string;
    let leaveTypeId: string;
    let groupId: string;

    beforeAll(async () => {
      org = await createEmployeeTestOrgMasters();
      subject = await createFullTestEmployee(org, { roleCode });
      report = await createFullTestEmployee(org, { managerId: subject.employeeId });
      colleague = await createFullTestEmployee(org);
      const leaveType = await prisma.leaveType.create({ data: { code: `TC${randomUUID().slice(0, 6)}`, name: "Cleanup test" } });
      leaveTypeId = leaveType.id;
      const group = await prisma.group.create({ data: { name: `Cleanup ${randomUUID().slice(0, 8)}` } });
      groupId = group.id;

      const e = subject.employeeId;
      const u = subject.userId;
      const day = new Date("2026-06-01");

      // User-owned rows, including a refresh-token rotation chain (self FK).
      const oldToken = await prisma.refreshToken.create({ data: { userId: u, tokenHash: randomUUID(), expiresAt: day } });
      const newToken = await prisma.refreshToken.create({ data: { userId: u, tokenHash: randomUUID(), expiresAt: day } });
      await prisma.refreshToken.update({ where: { id: oldToken.id }, data: { replacedByTokenId: newToken.id } });
      await prisma.notification.create({ data: { userId: u, type: "test", title: "t", body: "b" } });
      await prisma.userFavourite.create({ data: { userId: u, label: "l", icon: "i", path: "/p", rank: 0 } });
      await prisma.dashboardLayout.create({ data: { userId: u, layout: [] } });
      await prisma.savedView.create({ data: { userId: u, gridKey: "employees", name: "v", config: {} } });
      await prisma.auditLog.create({ data: { actorUserId: u, action: "test.by", entityType: "Test", entityId: randomUUID() } });
      await prisma.auditLog.create({ data: { action: "test.about", entityType: "Employee", entityId: e } });
      // A pre-existing setting the test user edited — must survive, un-pointed.
      await prisma.systemSetting.create({ data: { key: settingKey, value: 1, updatedByUserId: u } });

      // Employee-owned rows.
      await prisma.separation.create({ data: { employeeId: e, lastWorkingDate: day, reason: "r", initiatedByUserId: u } });
      await prisma.profileChangeRequest.create({ data: { employeeId: e, requestedByUserId: u, fieldGroup: "personal", changesJson: {} } });
      await prisma.leaveRequest.create({
        data: { employeeId: e, leaveTypeId, fromDate: day, toDate: day, totalDays: 1, appliedByUserId: u },
      });
      const grant = await prisma.leaveLedger.create({
        data: { employeeId: e, leaveTypeId, leaveYear: 2026, entryDate: day, entryType: "GRANT", days: 1 },
      });
      const credit = await prisma.compOffCredit.create({
        data: { employeeId: e, earnedDate: day, earnedDays: 1, remainingDays: 0, expiresOn: day, source: "MANUAL_GRANT", ledgerEntryId: grant.id },
      });
      await prisma.leaveLedger.create({
        data: { employeeId: e, leaveTypeId, leaveYear: 2026, entryDate: day, entryType: "CONSUMED", days: -1, compOffCreditId: credit.id },
      });
      await prisma.groupMember.create({ data: { groupId, employeeId: e } });

      // Engage: the subject's own poll post, voted/commented/reacted on by a
      // colleague; a kudos the subject gave; an auto-post about the subject;
      // and the subject's reaction on the colleague's post.
      const pollPost = await prisma.post.create({ data: { authorEmployeeId: e, groupId, kind: "POLL", body: "poll" } });
      const poll = await prisma.poll.create({ data: { postId: pollPost.id, question: "q" } });
      const option = await prisma.pollOption.create({ data: { pollId: poll.id, label: "a", rank: 0 } });
      await prisma.pollVote.create({ data: { pollId: poll.id, pollOptionId: option.id, employeeId: colleague.employeeId } });
      await prisma.comment.create({ data: { postId: pollPost.id, authorEmployeeId: colleague.employeeId, body: "c" } });
      await prisma.reaction.create({ data: { postId: pollPost.id, employeeId: colleague.employeeId, emoji: "👍" } });
      const kudosPost = await prisma.post.create({ data: { authorEmployeeId: e, kind: "KUDOS", body: "k" } });
      await prisma.kudos.create({ data: { postId: kudosPost.id, fromEmployeeId: e, toEmployeeId: colleague.employeeId, message: "m" } });
      await prisma.post.create({ data: { subjectEmployeeId: e, kind: "AUTO_JOINING", body: "joined", occurredOn: day } });
      const colleaguePost = await prisma.post.create({ data: { authorEmployeeId: colleague.employeeId, groupId, kind: "USER", body: "hi" } });
      colleaguePostId = colleaguePost.id;
      await prisma.reaction.create({ data: { postId: colleaguePost.id, employeeId: e, emoji: "🎉" } });

      await deleteEmployeesAndDependents([subject.employeeId]);
    });

    afterAll(async () => {
      await prisma.systemSetting.deleteMany({ where: { key: settingKey } });
      await deleteEmployeesAndDependents([report.employeeId, colleague.employeeId]);
      await deleteWithDependents("Group", [groupId]);
      await deleteWithDependents("LeaveType", [leaveTypeId]);
      await cleanupTestRole(roleCode);
      await cleanupEmployeeTestOrgMasters(org);
    });

    it("leaves no row anywhere in the schema pointing at the deleted employee or user", async () => {
      const leftovers: string[] = [];
      for (const model of Prisma.dmmf.datamodel.models) {
        for (const field of model.fields) {
          if (field.kind !== "object" || !field.relationFromFields?.length) continue;
          const target = field.type === "Employee" ? subject.employeeId : field.type === "User" ? subject.userId : null;
          if (!target) continue;
          const fk = field.relationFromFields[0]!;
          const key = model.name.charAt(0).toLowerCase() + model.name.slice(1);
          const count = await (prisma as unknown as Record<string, { count(a: object): Promise<number> }>)[key]!.count({
            where: { [fk]: target },
          });
          if (count > 0) leftovers.push(`${model.name}.${fk}: ${count}`);
        }
      }
      expect(leftovers).toEqual([]);
      expect(await prisma.employee.count({ where: { id: subject.employeeId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { entityId: subject.employeeId } })).toBe(0);
      expect(await prisma.post.count({ where: { kind: "POLL", body: "poll", groupId } })).toBe(0);
    });

    it("keeps rows that merely referenced the employee, with the pointer nulled", async () => {
      const setting = await prisma.systemSetting.findUniqueOrThrow({ where: { key: settingKey } });
      expect(setting.updatedByUserId).toBeNull();

      const reportJob = await prisma.employeeJobHistory.findFirstOrThrow({ where: { employeeId: report.employeeId } });
      expect(reportJob.reportingManagerId).toBeNull();

      const post = await prisma.post.findUniqueOrThrow({ where: { id: colleaguePostId }, include: { reactions: true } });
      expect(post.reactions).toEqual([]);
      expect(await prisma.employee.count({ where: { id: { in: [report.employeeId, colleague.employeeId] } } })).toBe(2);
    });
  });
});
