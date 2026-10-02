import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";
import { env } from "../config/env";
import { logger } from "../lib/logger";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { message: `Not found: ${req.method} ${req.path}` } });
}

// Central error handler — must be registered last, after all routes.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires 4 args to recognize an error handler
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { message: "Validation failed", code: "VALIDATION_ERROR", issues: err.issues },
    });
    return;
  }

  // The database's last-SUPER_ADMIN trigger (E1): a backstop for any path
  // the service-layer check didn't cover — surfaced as a clean 409.
  if (err instanceof Error && err.message.includes("LAST_SUPER_ADMIN:")) {
    res.status(409).json({ error: { message: "This is the last active Super Admin. Appoint another Super Admin first.", code: "LAST_SUPER_ADMIN" } });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code } });
    return;
  }

  // Multer errors (Import Center uploads) are user input mistakes — wrong
  // file type, file too large — not server faults.
  if (err instanceof MulterError || (err instanceof Error && err.message === "Only .xlsx files are accepted.")) {
    res.status(400).json({ error: { message: err.message, code: "INVALID_UPLOAD" } });
    return;
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    error: {
      message: env.APP_ENV === "production" ? "Internal server error" : message,
      code: "INTERNAL_ERROR",
    },
  });
}
