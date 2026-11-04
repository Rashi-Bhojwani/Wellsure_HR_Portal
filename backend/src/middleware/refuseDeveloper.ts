import type { NextFunction, Request, Response } from "express";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { HttpError } from "./errorHandler";
import "./types";

// A-9 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md): the Developer role builds and runs the system; it holds employee.view, so a route gated on a key it happens to
// hold would otherwise open to it. Every A-9 router refuses it outright (a director who also holds the Developer role is still a director).
export function refuseDeveloper(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
    return;
  }
  if (req.user.roleCodes.includes(DEVELOPER_ROLE_CODE) && !req.user.roleCodes.includes("SUPER_ADMIN")) {
    next(new HttpError(403, "The Developer role cannot use this.", "FORBIDDEN"));
    return;
  }
  next();
}
