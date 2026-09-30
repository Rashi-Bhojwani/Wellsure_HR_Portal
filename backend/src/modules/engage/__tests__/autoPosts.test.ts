import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { createJoiningPost, isEventDateCelebratedToday, runDailyAutoPosts } from "../autoPosts";
import { cleanupAutoPostTestEmployee, createAutoPostTestEmployee } from "./engageTestHelpers";

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

describe("Engage — auto-post 29 February rule (isEventDateCelebratedToday)", () => {
  it("an exact month/day match is always celebrated", () => {
    expect(isEventDateCelebratedToday(utcDate(1990, 5, 15), utcDate(2026, 5, 15))).toBe(true);
    expect(isEventDateCelebratedToday(utcDate(1990, 5, 15), utcDate(2026, 5, 16))).toBe(false);
  });

  it("a 29 Feb event is celebrated on 28 Feb in a non-leap year", () => {
    const leapBirthYear = utcDate(2000, 1, 29); // 29 Feb 2000 — a real leap day
    expect(isEventDateCelebratedToday(leapBirthYear, utcDate(2025, 1, 28))).toBe(true); // 2025 is not a leap year
    expect(isEventDateCelebratedToday(leapBirthYear, utcDate(2025, 1, 27))).toBe(false);
    expect(isEventDateCelebratedToday(leapBirthYear, utcDate(2025, 2, 1))).toBe(false); // never rolls to 1 March
  });

  it("a 29 Feb event is celebrated on the real 29th in a genuine leap year", () => {
    const leapBirthYear = utcDate(2000, 1, 29);
    expect(isEventDateCelebratedToday(leapBirthYear, utcDate(2028, 1, 29))).toBe(true); // 2028 is a leap year
    expect(isEventDateCelebratedToday(leapBirthYear, utcDate(2028, 1, 28))).toBe(false); // the real day exists this year — 28th doesn't match
  });
});

describe("Engage — auto-post cron: same-day idempotency", () => {
  const employeeIds: string[] = [];
  afterAll(async () => {
    for (const id of employeeIds) await cleanupAutoPostTestEmployee(id);
  });

  it("running the daily batch twice for the same day creates exactly one post, not two", async () => {
    const today = utcDate(2026, 3, 15); // 15 April — clear of the Feb 29 edge case
    const dob = utcDate(1992, 3, 15);
    const empId = await createAutoPostTestEmployee({ dateOfJoining: utcDate(2020, 0, 1), dateOfBirth: dob });
    employeeIds.push(empId);

    await runDailyAutoPosts(today);
    await runDailyAutoPosts(today); // retried run — must be a no-op for this employee

    const posts = await prisma.post.findMany({ where: { subjectEmployeeId: empId, kind: "AUTO_BIRTHDAY" } });
    expect(posts).toHaveLength(1);
  });

  it("a different day's run creates a second, distinct post — the index doesn't block a new year's occurrence", async () => {
    const nextYear = utcDate(2027, 3, 15);
    const empId = employeeIds[0]!;

    await runDailyAutoPosts(nextYear);

    const posts = await prisma.post.findMany({ where: { subjectEmployeeId: empId, kind: "AUTO_BIRTHDAY" }, orderBy: { occurredOn: "asc" } });
    expect(posts).toHaveLength(2);
    expect(posts[0]!.occurredOn?.toISOString().slice(0, 10)).toBe("2026-04-15");
    expect(posts[1]!.occurredOn?.toISOString().slice(0, 10)).toBe("2027-04-15");
  });
});

describe("Engage — auto-post cron: a duplicate-key skip for one employee never aborts the rest of the batch", () => {
  const employeeIds: string[] = [];
  afterAll(async () => {
    for (const id of employeeIds) await cleanupAutoPostTestEmployee(id);
  });

  it("employee A already has today's post (a retried/partial run); employee B doesn't — both come out correct in one call", async () => {
    const today = utcDate(2026, 6, 20); // 20 July
    const dob = utcDate(1988, 6, 20);

    const empA = await createAutoPostTestEmployee({ dateOfJoining: utcDate(2019, 0, 1), dateOfBirth: dob });
    employeeIds.push(empA);
    const empB = await createAutoPostTestEmployee({ dateOfJoining: utcDate(2019, 0, 1), dateOfBirth: dob });
    employeeIds.push(empB);

    // Simulate A already having been posted for today by a prior partial run.
    await prisma.post.create({
      data: { subjectEmployeeId: empA, kind: "AUTO_BIRTHDAY", body: "pre-existing", occurredOn: today },
    });

    // A's insert attempt below will hit the partial unique index (P2002) and
    // must be caught as an idempotent skip — the loop must still reach B.
    await runDailyAutoPosts(today);

    const aPosts = await prisma.post.findMany({ where: { subjectEmployeeId: empA, kind: "AUTO_BIRTHDAY" } });
    expect(aPosts).toHaveLength(1);
    expect(aPosts[0]!.body).toBe("pre-existing"); // untouched, not overwritten

    const bPosts = await prisma.post.findMany({ where: { subjectEmployeeId: empB, kind: "AUTO_BIRTHDAY" } });
    expect(bPosts).toHaveLength(1); // B's insert succeeded despite A's failure earlier in the loop
  });
});

describe("Engage — auto-post cron: work anniversaries", () => {
  const employeeIds: string[] = [];
  afterAll(async () => {
    for (const id of employeeIds) await cleanupAutoPostTestEmployee(id);
  });

  it("posts an anniversary for an employee whose join-date month/day matches today and who has completed >= 1 year", async () => {
    const today = utcDate(2026, 8, 1); // 1 September
    const empId = await createAutoPostTestEmployee({ dateOfJoining: utcDate(2023, 8, 1) });
    employeeIds.push(empId);

    await runDailyAutoPosts(today);

    const posts = await prisma.post.findMany({ where: { subjectEmployeeId: empId, kind: "AUTO_ANNIVERSARY" } });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toContain("3"); // 2026 - 2023 = 3 years
  });

  it("does not post an anniversary for an employee who joined less than a year ago", async () => {
    const today = utcDate(2026, 8, 1);
    const empId = await createAutoPostTestEmployee({ dateOfJoining: utcDate(2026, 7, 1) }); // joined last month, month/day doesn't even match
    employeeIds.push(empId);

    await runDailyAutoPosts(today);

    const posts = await prisma.post.findMany({ where: { subjectEmployeeId: empId, kind: "AUTO_ANNIVERSARY" } });
    expect(posts).toHaveLength(0);
  });
});

describe("Engage — joining posts fire on the actual joining event, not the cron", () => {
  const employeeIds: string[] = [];
  afterAll(async () => {
    for (const id of employeeIds) await cleanupAutoPostTestEmployee(id);
  });

  it("createJoiningPost posts immediately, keyed on the employee's real dateOfJoining", async () => {
    const doj = utcDate(2026, 2, 10); // 10 March
    const empId = await createAutoPostTestEmployee({ dateOfJoining: doj });
    employeeIds.push(empId);

    await createJoiningPost(empId);

    const posts = await prisma.post.findMany({ where: { subjectEmployeeId: empId, kind: "AUTO_JOINING" } });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.occurredOn?.toISOString().slice(0, 10)).toBe("2026-03-10");
  });

  it("is idempotent on retry (the same duplicate-key skip the daily cron uses)", async () => {
    const empId = employeeIds[0]!;
    await createJoiningPost(empId); // a second call must not create a second post
    const posts = await prisma.post.findMany({ where: { subjectEmployeeId: empId, kind: "AUTO_JOINING" } });
    expect(posts).toHaveLength(1);
  });

  it("the daily cron never scans for or creates AUTO_JOINING posts, even on the employee's actual join-date match day", async () => {
    const doj = utcDate(2026, 4, 5); // 5 May
    const empId = await createAutoPostTestEmployee({ dateOfJoining: doj });
    employeeIds.push(empId);

    // Run the cron for the exact day that matches this employee's DOJ
    // month/day — runDailyAutoPosts only scans for BIRTHDAY/ANNIVERSARY,
    // never JOINING (see its own header comment) — no post should appear
    // until createJoiningPost is explicitly called.
    await runDailyAutoPosts(doj);
    let posts = await prisma.post.findMany({ where: { subjectEmployeeId: empId, kind: "AUTO_JOINING" } });
    expect(posts).toHaveLength(0);

    await createJoiningPost(empId);
    posts = await prisma.post.findMany({ where: { subjectEmployeeId: empId, kind: "AUTO_JOINING" } });
    expect(posts).toHaveLength(1);
  });
});
