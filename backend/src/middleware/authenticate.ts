import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { developerWriteRefused } from "../lib/developerFirewall";
import { resolveAccess } from "../lib/permissions";
import { prisma } from "../lib/prisma";
import { HttpError } from "./errorHandler";
import type { AuthenticatedUser } from "./types";
import "./types";

// Verifies the access token and re-checks the account's live status in the
// database — not just the token's own expiry. A deactivated/suspended
// account must lose access immediately, not wait up to JWT_ACCESS_TTL
// (15m) for its last token to expire. Returns null (never throws) when no
// bearer token is present, so optionalAuthenticate can fall through.
async function tryAuthenticate(req: Request): Promise<AuthenticatedUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  let userId: string;
  try {
    userId = verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    throw new HttpError(401, "Invalid or expired access token", "UNAUTHENTICATED");
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, employeeId: true, status: true } });
  if (!user || user.status !== "ACTIVE") {
    throw new HttpError(401, "Account is not active", "UNAUTHENTICATED");
  }

  // The one resolver (lib/permissions.ts): roles + overrides, SUPER_ADMIN
  // gets everything in code. Re-read on every request, so an access change
  // takes effect on the user's very next call.
  const { roleCodes, permissions, dataScope } = await resolveAccess(user.id);
  return { userId: user.id, employeeId: user.employeeId, roleCodes, permissions, dataScope };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await tryAuthenticate(req);
    if (!user) {
      next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
      return;
    }
    req.user = user;
    // FIX-C3/H5/M7 (independent audit 2026-11-20): the Developer role is view and diagnostics only (lib/developerFirewall.ts).
    if (developerWriteRefused(user.roleCodes, req.method, req.originalUrl)) {
      next(new HttpError(403, "The Developer role is view and diagnostics only: it cannot change employee, leave, pay, attendance or identity data.", "DEVELOPER_VIEW_ONLY"));
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

// For routes reachable either with a full session or via a separate
// short-lived challenge token in the body (the login-time TOTP
// setup/verify endpoints) — populates req.user when a valid bearer token
// is present, otherwise leaves it undefined for the controller to resolve
// another way, rather than 401ing outright.
export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await tryAuthenticate(req);
    if (user) {
      req.user = user;
    }
    next();
  } catch (err) {
    next(err);
  }
}
