import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { emitEngageBirthday, emitEngageJoining, emitEngageAnniversary } from "../../realtime/emit";
import { getAutoPostSetting } from "./autoPostSettings";
import { FEED_INCLUDE, formatPost } from "./posts";
import { inForceOn } from "../../lib/effectiveDating";

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

// True when `eventDate`'s month/day is celebrated on `today`. A 29
// February event is celebrated on 28 February in a non-leap year — the
// stored `occurredOn` is always the real calendar date used for the
// match (today), so the partial unique index on (kind, subjectEmployeeId,
// occurredOn) never double-fires later the same year, and a genuine leap
// year still matches on the real 29th.
export function isEventDateCelebratedToday(eventDate: Date, today: Date): boolean {
  const eventMonth = eventDate.getUTCMonth();
  const eventDay = eventDate.getUTCDate();
  if (eventMonth === today.getUTCMonth() && eventDay === today.getUTCDate()) return true;

  const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return (
    eventMonth === 1 &&
    eventDay === 29 &&
    today.getUTCMonth() === 1 &&
    today.getUTCDate() === 28 &&
    !isLeapYear(today.getUTCFullYear())
  );
}

interface AutoPostAttempt {
  subjectEmployeeId: string;
  kind: "AUTO_BIRTHDAY" | "AUTO_JOINING" | "AUTO_ANNIVERSARY";
  body: string;
}

// Each attempt is its own insert, individually try/caught — a duplicate-
// key violation (P2002, from the partial unique index — a retried run, or
// a genuine race) is an idempotent skip; any other error is logged and
// counted as failed, but the loop always continues to the next employee.
// One employee's row is never allowed to abort the whole batch.
async function createAutoPost(attempt: AutoPostAttempt, occurredOn: Date): Promise<"created" | "skipped" | "failed"> {
  try {
    const post = await prisma.post.create({
      data: { subjectEmployeeId: attempt.subjectEmployeeId, kind: attempt.kind, body: attempt.body, occurredOn },
      include: FEED_INCLUDE(),
    });
    // No single "viewer" for a broadcast system post — a fresh post has no
    // reactions/votes yet anyway, so viewerReaction/viewerVotedOptionId are
    // always null here regardless of what's passed.
    const formatted = formatPost(post, "");
    if (attempt.kind === "AUTO_BIRTHDAY") emitEngageBirthday(formatted);
    else if (attempt.kind === "AUTO_JOINING") emitEngageJoining(formatted);
    else emitEngageAnniversary(formatted);
    return "created";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return "skipped"; // already posted for this employee+date — idempotent retry
    }
    logger.error({ err, subjectEmployeeId: attempt.subjectEmployeeId, kind: attempt.kind }, "engage auto-post insert failed");
    return "failed";
  }
}

// The daily 08:00 IST batch (spec §8) — scans every ACTIVE employee for a
// birthday or work anniversary landing on `today`, per the settings'
// enabled flag and template. Joining posts are NOT scanned here — they
// fire on the actual joining event (see createJoiningPost, called from
// auth/service.ts's acceptInvitation), never on this cron.
export async function runDailyAutoPosts(today: Date): Promise<{ created: number; skipped: number; failed: number }> {
  const [birthdaySetting, anniversarySetting] = await Promise.all([
    getAutoPostSetting("BIRTHDAY"),
    getAutoPostSetting("ANNIVERSARY"),
  ]);
  if (!birthdaySetting.enabled && !anniversarySetting.enabled) return { created: 0, skipped: 0, failed: 0 };

  const employees = await prisma.employee.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      dateOfJoining: true,
      personal: { select: { dateOfBirth: true } },
      nameHistory: { where: inForceOn(), select: { fullName: true } },
    },
  });

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const employee of employees) {
    const name = employee.nameHistory[0]?.fullName ?? "your colleague";

    if (birthdaySetting.enabled && employee.personal && isEventDateCelebratedToday(employee.personal.dateOfBirth, today)) {
      const result = await createAutoPost(
        { subjectEmployeeId: employee.id, kind: "AUTO_BIRTHDAY", body: renderTemplate(birthdaySetting.template, { name }) },
        today,
      );
      if (result === "created") created++;
      else if (result === "skipped") skipped++;
      else failed++;
    }

    if (anniversarySetting.enabled && isEventDateCelebratedToday(employee.dateOfJoining, today)) {
      const years = today.getUTCFullYear() - employee.dateOfJoining.getUTCFullYear();
      if (years >= 1) {
        const result = await createAutoPost(
          { subjectEmployeeId: employee.id, kind: "AUTO_ANNIVERSARY", body: renderTemplate(anniversarySetting.template, { name, years: String(years) }) },
          today,
        );
        if (result === "created") created++;
        else if (result === "skipped") skipped++;
        else failed++;
      }
    }
  }

  return { created, skipped, failed };
}

// Fires on the actual joining event — called from acceptInvitation, not
// from the daily cron. occurredOn is the employee's real dateOfJoining
// (the date being celebrated), which can differ from "today" (when they
// happened to accept their invite) — the idempotency key stays keyed on
// the date that matters, not the moment the hook fired.
export async function createJoiningPost(employeeId: string): Promise<void> {
  const setting = await getAutoPostSetting("JOINING");
  if (!setting.enabled) return;

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { dateOfJoining: true, nameHistory: { where: inForceOn(), select: { fullName: true } } },
  });
  if (!employee) return;
  const name = employee.nameHistory[0]?.fullName ?? "our newest team member";
  const date = employee.dateOfJoining.toISOString().slice(0, 10);

  await createAutoPost(
    { subjectEmployeeId: employeeId, kind: "AUTO_JOINING", body: renderTemplate(setting.template, { name, date }) },
    employee.dateOfJoining,
  );
}
