import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt";
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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!user || user.status !== "ACTIVE") {
    throw new HttpError(401, "Account is not active", "UNAUTHENTICATED");
  }

  const permissions = new Set<string>();
  const roleCodes: string[] = [];
  for (const userRole of user.roles) {
    roleCodes.push(userRole.role.code);
    for (const rolePermission of userRole.role.permissions) {
      permissions.add(rolePermission.permission.key);
    }
  }
  return { userId: user.id, employeeId: user.employeeId, roleCodes, permissions };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await tryAuthenticate(req);
    if (!user) {
      next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
      return;
    }
    req.user = user;
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
