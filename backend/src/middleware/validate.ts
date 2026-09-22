import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

// Factory for a request-validation middleware. Zod errors thrown here are
// caught by errorHandler.ts and turned into a 400 response. No routes use
// this yet — real endpoints start in Phase 1.
export function validate(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query) as Request["query"];
      if (schemas.params) req.params = schemas.params.parse(req.params) as Request["params"];
      next();
    } catch (err) {
      next(err);
    }
  };
}
