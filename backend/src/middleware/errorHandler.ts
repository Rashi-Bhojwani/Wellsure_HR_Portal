import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
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

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code } });
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
