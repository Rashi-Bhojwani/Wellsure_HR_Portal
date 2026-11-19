import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BADGE_CATALOGUE, DEFAULT_NUDGE_TAGS } from "@shared/constants/peeps";
import { METRICS } from "../../insights/service";

// Final merge, meeting point (c): the lateness rule (Session A's, merged) stays out of Peeps. No Peeps module reads lateness, its cut-offs,
// consequences or waivers, or attendance late-in data; the shipped nudge tags, badges and Insights metrics name nothing about attendance, lateness or
// performance (a nudge or a badge is never a lateness consequence).

const PEEPS_MODULES = ["peeps", "recruitment", "exits", "unmute", "assets", "recognition", "insights", "autofill", "leaveRules", "avatars"];
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return name.endsWith(".ts") ? [full] : [];
  });

describe("Peeps and the lateness rule", () => {
  it("no Peeps module imports the lateness module or reads lateness waivers, cut-offs or late-in minutes", () => {
    const offenders: string[] = [];
    for (const m of PEEPS_MODULES) {
      for (const f of sourceFiles(path.resolve(__dirname, "../..", m))) {
        const text = readFileSync(f, "utf8");
        if (/modules\/lateness|from "\.\.\/lateness|lateWaiver|late_waivers|LateWaiver|latenessRule|lateInMinutes|lateness\./i.test(text)) offenders.push(path.relative(path.resolve(__dirname, "../.."), f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the shipped nudge tags, badges and Insights metrics name nothing about attendance, lateness or performance", () => {
    const words = /late|tardy|absen|attend|punch|on time|early|miss|skip|perform|warning|lop\b|waiver|grace/i;
    for (const t of DEFAULT_NUDGE_TAGS) expect(`${t.code} ${t.label}`, t.code).not.toMatch(words);
    for (const b of DEFAULT_BADGE_CATALOGUE) expect(`${b.code} ${b.label}`, b.code).not.toMatch(/late|tardy|absen|attend|punch|on time|miss|skip|warning|lop\b|waiver|grace/i);
    for (const [metric, settings] of Object.entries(METRICS)) expect(`${metric} ${settings.join(" ")}`, metric).not.toMatch(/late|attend|punch|lop\b|waiver|perform/i);
  });
});
