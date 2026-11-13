import { logger } from "../../lib/logger";
import { sendProbationReminders } from "../probation/service";

// M session block 2: one daily job for the people rows (probation reminders and, as they are built, the others). Each step is independent: one
// failing is logged and the rest still run.
export async function runPeopleDaily(): Promise<Record<string, number | string>> {
  const out: Record<string, number | string> = {};
  const steps: Array<[string, () => Promise<number>]> = [["probationReminders", () => sendProbationReminders()]];
  for (const [name, fn] of steps) {
    try {
      out[name] = await fn();
    } catch (err) {
      logger.error({ err, step: name }, "people-daily step failed");
      out[name] = "failed";
    }
  }
  return out;
}
