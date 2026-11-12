import request from "supertest";
import { expect } from "vitest";
import { prisma } from "../../../lib/prisma";
import { policyDef } from "@shared/constants/policySettings";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";

/** One director proposes, the other confirms: the setting is then in force. */
export async function setPolicy(key: string, value: Record<string, unknown>, proposerToken: string, confirmerToken: string) {
  const p = await request(app).post(`/api/policy-settings/${key}/proposals`).set(...authHeader(proposerToken)).send({ value, reason: "Test setting" });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  const c = await request(app).post(`/api/policy-settings/proposals/${p.body.id}/confirm`).set(...authHeader(confirmerToken));
  expect(c.status, JSON.stringify(c.body)).toBe(200);
}

/** Back to the starting state for later test files: plain = its default, activation = off, notSet = cleared fields. */
export async function resetPolicy(key: string, proposerToken: string, confirmerToken: string) {
  const def = policyDef(key)!;
  const any = await prisma.behaviourProposal.count({ where: { key } });
  if (!any) return;
  const base = def.kind === "notSet" ? Object.fromEntries(def.fields.map((f) => [f.name, f.type === "codes" ? [] : f.type === "choice" ? f.options[0]!.value : null])) : { ...(def.defaultValue ?? {}) };
  await setPolicy(key, def.kind === "activation" ? { ...base, active: false } : base, proposerToken, confirmerToken);
}
