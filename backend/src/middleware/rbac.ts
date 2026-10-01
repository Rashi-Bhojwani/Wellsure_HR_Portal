import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errorHandler";
import "./types";

// Requires an authenticated request (req.user populated by the JWT
// access-token middleware — commit B). Route-specific permission checks
// should use requirePermission() instead, which implies this.
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
    return;
  }
  next();
}

// Requires the authenticated user to hold the given permission key (spec
// §2's granular permission strings). Data-scope (SELF/TEAM/ALL) narrowing
// is separate — see dataScope.ts — since "may this endpoint be called at
// all" and "which rows may it see" are independent questions.
export function requirePermission(key: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
      return;
    }
    if (!req.user.permissions.has(key)) {
      next(new HttpError(403, `Missing permission: ${key}`, "FORBIDDEN"));
      return;
    }
    next();
  };
}

// Requires at least one of the given permission keys — for a read that
// serves two different jobs (e.g. the letter template list is needed both
// by template editors and by people who only issue letters).
export function requireAnyPermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
      return;
    }
    if (!keys.some((k) => req.user!.permissions.has(k))) {
      next(new HttpError(403, `Missing permission: one of ${keys.join(", ")}`, "FORBIDDEN"));
      return;
    }
    next();
  };
}
