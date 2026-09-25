import type { NextFunction, Request, Response } from "express";
import { redis } from "../lib/redis";
import { getSetting } from "../lib/settings";
import { HttpError } from "./errorHandler";

export interface RateLimitConfig {
  maxAttempts: number;
  windowSeconds: number;
}

// IP-scoped rate limiting for public/sensitive auth endpoints (login,
// forgot-password, invite accept, reset password, 2FA verify), with the
// limit itself stored in SystemSetting so it's adjustable without a
// deploy. This is deliberately separate from the per-account lockout
// (User.failedLoginAttempts/lockedUntil) — that stops one account being
// brute-forced; this stops the endpoint itself being hammered (e.g. to
// enumerate Employee Codes or spam reset emails).
export function rateLimit(settingKey: string, defaultConfig: RateLimitConfig) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const config = await getSetting<RateLimitConfig>(settingKey, defaultConfig);
      const identifier = req.ip ?? "unknown";
      const redisKey = `ratelimit:${settingKey}:${identifier}`;

      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.expire(redisKey, config.windowSeconds);
      }
      if (count > config.maxAttempts) {
        next(new HttpError(429, "Too many requests. Please try again later.", "RATE_LIMITED"));
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
