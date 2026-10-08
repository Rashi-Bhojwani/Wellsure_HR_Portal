import { createHash, randomBytes } from "node:crypto";
import type { BiometricAgent } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";

// Sync-agent credentials (docs/plans/PHASE_2.md §2.2): a random key shown
// once, stored only as its SHA-256 (the key is 32 random bytes, so a plain
// hash is enough — there's nothing to brute-force), sent as
// `Authorization: Bearer <key>`.

export const AGENT_KEY_PREFIX = "wsa_";

export function newAgentKey(): { key: string; hash: string; prefix: string } {
  const key = `${AGENT_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashAgentKey(key), prefix: key.slice(0, 10) };
}

export function hashAgentKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own augmentation pattern
  namespace Express {
    interface Request {
      agent?: BiometricAgent;
    }
  }
}

/** Requires a valid, active agent key. Never says whether a key exists. */
export async function authenticateAgent(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.get("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const agent = key.startsWith(AGENT_KEY_PREFIX) ? await prisma.biometricAgent.findUnique({ where: { keyHash: hashAgentKey(key) } }) : null;
    if (!agent?.isActive) {
      next(new HttpError(401, "Invalid or inactive agent key.", "AGENT_UNAUTHENTICATED"));
      return;
    }
    req.agent = agent;
    next();
  } catch (err) {
    next(err);
  }
}
