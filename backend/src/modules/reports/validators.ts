import { z } from "zod";
import { REPORT_KEYS } from "@shared/constants/reports";

const date = z.iso.date().optional();

export const keyParamsSchema = z.object({ key: z.enum(REPORT_KEYS) });
export const reportQuerySchema = z.object({
  asOf: date,
  from: date,
  to: date,
  departmentId: z.string().min(1).optional(),
  locationId: z.string().min(1).optional(),
  employmentType: z.enum(["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT", "PROBATION"]).optional(),
  leaveTypeId: z.string().min(1).optional(),
  kind: z.enum(["all", "birthday", "anniversary"]).optional(),
});
