import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { personalEmailAllowed } from "../../modules/employee/validators";

// FIX-L4 (independent audit 2026-11-20, finding L4): tests used real public mail domains (gmail.com, yahoo.com) and the personal-email validator only accepted
// gmail.com, so development data needed a real domain. Production rule (chosen): a personal email must be a gmail.com address, as the owners decided. Outside
// production a reserved test domain (example.invalid, *.test, *.example, example.com/.org/.net) is accepted too, and tests and development data use only those.
describe("FIX-L4: reserved mail domains in tests and development data", () => {
  it("production accepts gmail.com only; elsewhere a reserved test domain is accepted too, and a real non-gmail domain never", () => {
    expect(personalEmailAllowed("someone@gmail.com", "production")).toBe(true);
    expect(personalEmailAllowed("someone@example.invalid", "production")).toBe(false);
    for (const env of ["development", "staging"]) {
      expect(personalEmailAllowed("someone@example.invalid", env)).toBe(true);
      expect(personalEmailAllowed("someone@team.test", env)).toBe(true);
      expect(personalEmailAllowed("someone@example.com", env)).toBe(true);
      expect(personalEmailAllowed("someone@yahoo.com", env)).toBe(false);
    }
  });

  it("no test, helper, seed or demo script uses a real public mail domain (the mail guard's own two tests use a recording transport and are listed)", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const out = execFileSync("git", ["grep", "-l", "-I", "-E", "@(gmail|yahoo|hotmail|outlook)\\.com", "--", "backend/src", "backend/prisma", "backend/scripts", "frontend/src", "frontend/e2e", "biometric-agent/src"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    const allowed = ["backend/src/modules/employee/validators.ts", "backend/src/config/env.ts", "backend/src/integrations/mail/__tests__/guard.test.ts", "backend/src/integrations/mail/__tests__/smtp.test.ts", "backend/src/lib/__tests__/fixL4MailDomains.test.ts"];
    expect(out.filter((f) => !allowed.includes(f))).toEqual([]);
  });
});
