// FIX-M9 (independent audit 2026-11-20): the npm audit guard. Run: node --test scripts/__tests__/check-audit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { problems } from "../check-audit.mjs";

const v = (severity) => ({ severity });

test("the audit's case: a high advisory (nodemailer, as reported) fails the check", () => {
  assert.deepEqual(problems({ backend: { vulnerabilities: { nodemailer: v("high") } } }), ["backend: nodemailer (high)"]);
});

test("a critical advisory in any project fails; moderate and low do not", () => {
  assert.deepEqual(problems({ root: { vulnerabilities: { "shell-quote": v("critical"), a: v("moderate"), b: v("low") } } }), ["root: shell-quote (critical)"]);
});

test("an accepted advisory passes only in the project it is accepted for", () => {
  assert.deepEqual(problems({ backend: { vulnerabilities: { prisma: v("high"), effect: v("high") } } }), []);
  assert.deepEqual(problems({ frontend: { vulnerabilities: { prisma: v("high") } } }), ["frontend: prisma (high)"]);
});
