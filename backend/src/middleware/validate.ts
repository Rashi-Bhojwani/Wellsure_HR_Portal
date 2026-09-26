import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

// Factory for a request-validation middleware. Zod errors thrown here are
// caught by errorHandler.ts and turned into a 400 response.
export function validate(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) {
        // Express 5 makes req.query a getter-only accessor (computed fresh
        // from req.url) — a plain `req.query = ...` throws "Cannot set
        // property query which has only a getter". Redefine it as an
        // ordinary writable property so the parsed/coerced value (Zod's
        // z.coerce.number() defaults, etc.) actually sticks for downstream
        // handlers.
        Object.defineProperty(req, "query", { value: schemas.query.parse(req.query), writable: true, configurable: true });
      }
      if (schemas.params) req.params = schemas.params.parse(req.params) as Request["params"];
      next();
    } catch (err) {
      next(err);
    }
  };
}
