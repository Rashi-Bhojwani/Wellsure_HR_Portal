import request from "supertest";
import { expect } from "vitest";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";

/** One director proposes, the other confirms: the setting is then in force. */
export async function setPolicy(key: string, value: Record<string, unknown>, proposerToken: string, confirmerToken: string) {
  const p = await request(app).post(`/api/policy-settings/${key}/proposals`).set(...authHeader(proposerToken)).send({ value, reason: "Test setting" });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  const c = await request(app).post(`/api/policy-settings/proposals/${p.body.id}/confirm`).set(...authHeader(confirmerToken));
  expect(c.status, JSON.stringify(c.body)).toBe(200);
}

/**
 * Back to the starting state for later test files: every proposal for the key is removed (through the test purge), so the setting reads exactly
 * as on a fresh database (plain = its default, activation = off, notSet = Not set). Test databases only.
 */
export async function resetPolicy(key: string, _proposerToken?: string, _confirmerToken?: string) {
  const rows = await prisma.behaviourProposal.findMany({ where: { key }, select: { id: true } });
  if (rows.length) await deleteWithDependents("BehaviourProposal", rows.map((r) => r.id));
}
