import { createHash, randomBytes } from "node:crypto";
import type { RefreshToken } from "@prisma/client";
import { env } from "../../config/env";
import { parseDurationMs } from "../../lib/duration";
import { prisma } from "../../lib/prisma";

export interface RequestMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface IssuedRefreshToken {
  token: string; // raw — only ever returned once, set as the httpOnly cookie value
  row: RefreshToken;
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueRefreshToken(userId: string, meta: RequestMeta): Promise<IssuedRefreshToken> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + parseDurationMs(env.JWT_REFRESH_TTL));
  const row = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(token),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
      expiresAt,
    },
  });
  return { token, row };
}

export async function findRefreshTokenByRawToken(token: string): Promise<RefreshToken | null> {
  return prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(token) } });
}

export type RefreshOutcome =
  | { kind: "valid"; row: RefreshToken }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "reused"; userId: string };

// Reuse detection: a token that's already been ROTATED (revokedAt set
// *and* replacedByTokenId set) being presented again means either it
// leaked and an attacker rotated it, or it's a legitimate client racing a
// rotation — spec §9 requires treating this as compromise and revoking
// the whole chain. A token revoked by a plain logout (revokedAt set,
// replacedByTokenId null) is just an ended session presented again —
// that's an ordinary invalid-token case, not an attack signal, and must
// not cascade into revoking the user's *other*, still-legitimate sessions.
export async function checkRefreshToken(token: string): Promise<RefreshOutcome> {
  const row = await findRefreshTokenByRawToken(token);
  if (!row) {
    return { kind: "not_found" };
  }
  if (row.revokedAt && row.replacedByTokenId) {
    return { kind: "reused", userId: row.userId };
  }
  if (row.revokedAt) {
    return { kind: "not_found" };
  }
  if (row.expiresAt < new Date()) {
    return { kind: "expired" };
  }
  return { kind: "valid", row };
}

// Two concurrent /refresh calls presenting the same still-valid token (a
// real, observed case: React StrictMode double-invokes AuthProvider's
// mount effect in dev, firing two independent, undeduplicated
// authApi.refresh() calls) both used to pass checkRefreshToken's read,
// then both issue a new child and both update the same old row — the
// second update silently overwrites the first's replacedByTokenId, so a
// second valid child ends up orphaned (unlinked, but real and usable),
// which is a duplicated session, not the security-relevant "reuse" case.
// The update below is the atomic claim: `revokedAt: null` in the WHERE
// clause means only the first of any concurrent pair actually revokes the
// row, so callers can tell who won.
export async function rotateRefreshToken(oldRow: RefreshToken, meta: RequestMeta): Promise<IssuedRefreshToken | null> {
  const issued = await issueRefreshToken(oldRow.userId, meta);
  const claim = await prisma.refreshToken.updateMany({
    where: { id: oldRow.id, revokedAt: null },
    data: { revokedAt: new Date(), replacedByTokenId: issued.row.id, lastUsedAt: new Date() },
  });
  if (claim.count === 0) {
    // Lost the race — a concurrent call already rotated this token first.
    // Don't leave our own now-pointless child token behind.
    await prisma.refreshToken.delete({ where: { id: issued.row.id } });
    return null;
  }
  return issued;
}

export async function revokeRefreshTokenById(id: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function listActiveSessions(userId: string) {
  return prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
}
