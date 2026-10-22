import type { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { HttpError } from "../../../middleware/errorHandler";
import { compare, resultWorkbook } from "./service";

// POST /api/payroll/compare (multipart: files "a" and "b", and the options as fields). The files live in memory for the length of the request.
export const compareUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 2 } }).fields([{ name: "a", maxCount: 1 }, { name: "b", maxCount: 1 }]);

const source = z.enum(["OWN", "GENERIC", "GREYTHR"]);
const bodySchema = z.object({
  labelA: z.string().trim().max(40).default("Wellsure"),
  labelB: z.string().trim().max(40).default("greytHR"),
  sourceA: source.default("OWN"),
  sourceB: source.default("GENERIC"),
  toleranceAmount: z.string().trim().max(20).optional(),
  tolerancePercent: z.string().trim().max(20).optional(),
  aliases: z.string().max(4000).optional(),
  format: z.enum(["json", "xlsx"]).default("json"),
});

export async function compareRegistersRoute(req: Request, res: Response): Promise<void> {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const a = files?.a?.[0];
  const b = files?.b?.[0];
  if (!a || !b || a.size === 0 || b.size === 0) throw new HttpError(400, "Attach both registers (two Excel files).", "INVALID_UPLOAD");
  const body = bodySchema.parse(req.body);
  let aliases: Record<string, string> = {};
  if (body.aliases) {
    try {
      aliases = z.record(z.string().max(80), z.string().max(80)).parse(JSON.parse(body.aliases));
    } catch {
      throw new HttpError(400, "The column matches must be a list of “label in the second file → label in the first”.", "VALIDATION_ERROR");
    }
  }
  const result = await compare(
    { a: { buffer: a.buffer, label: body.labelA, source: body.sourceA, fileName: a.originalname }, b: { buffer: b.buffer, label: body.labelB, source: body.sourceB, fileName: b.originalname }, ...(body.toleranceAmount ? { toleranceAmount: body.toleranceAmount } : {}), ...(body.tolerancePercent ? { tolerancePercent: body.tolerancePercent } : {}), aliases },
    { userId: req.user!.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null },
  );
  if (body.format === "xlsx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="register-comparison.xlsx"');
    res.status(200).send(await resultWorkbook(result));
    return;
  }
  res.status(200).json(result);
}
