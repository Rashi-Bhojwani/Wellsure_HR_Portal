import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { requireAuth, requirePermission } from "../rbac";
import { HttpError } from "../errorHandler";

function makeRequest(user?: Request["user"]): Request {
  return { user } as Request;
}

describe("requireAuth", () => {
  it("calls next() when req.user is set", () => {
    const next = vi.fn();
    requireAuth(makeRequest({ userId: "u1", employeeId: "e1", roleCodes: [], dataScope: "SELF" as const, permissions: new Set() }), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("passes a 401 HttpError to next() when req.user is missing", () => {
    const next = vi.fn();
    requireAuth(makeRequest(undefined), {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]![0] as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(401);
  });
});

describe("requirePermission", () => {
  it("calls next() when the user holds the required permission", () => {
    const next = vi.fn();
    const middleware = requirePermission("employee.view");
    middleware(
      makeRequest({ userId: "u1", employeeId: "e1", roleCodes: ["HR_ADMIN"], dataScope: "SELF" as const, permissions: new Set(["employee.view"]) }),
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("passes a 403 HttpError when the user lacks the required permission", () => {
    const next = vi.fn();
    const middleware = requirePermission("employee.bank.view");
    middleware(
      makeRequest({ userId: "u1", employeeId: "e1", roleCodes: ["HR_EXECUTIVE"], dataScope: "SELF" as const, permissions: new Set(["employee.view"]) }),
      {} as Response,
      next,
    );
    const err = next.mock.calls[0]![0] as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(403);
  });

  it("passes a 401 HttpError when unauthenticated, before checking permissions", () => {
    const next = vi.fn();
    const middleware = requirePermission("employee.view");
    middleware(makeRequest(undefined), {} as Response, next);
    const err = next.mock.calls[0]![0] as HttpError;
    expect(err.status).toBe(401);
  });
});
