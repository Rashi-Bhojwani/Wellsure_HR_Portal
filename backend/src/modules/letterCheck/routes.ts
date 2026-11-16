import { Router } from "express";
import { memoryUpload, requireFile } from "../../lib/uploads";
import { rateLimit } from "../../middleware/rateLimit";
import { HttpError } from "../../middleware/errorHandler";
import { checkLetter } from "./service";

// M session block 2, LT-09: public (no sign-in) by design: the people checking a letter are outside the company. Rate-limited per address; the
// answer carries no personal data (see the service).
export const letterCheckRouter = Router();
const LETTER_CHECK_RATE_LIMIT = { maxAttempts: 30, windowSeconds: 3600 };

letterCheckRouter.post("/", rateLimit("letters.rateLimit.check", LETTER_CHECK_RATE_LIMIT), memoryUpload(10), async (req, res) => {
  const file = requireFile(req.file);
  if (!file.buffer.subarray(0, 5).toString("latin1").startsWith("%PDF")) throw new HttpError(400, "Upload the letter as the PDF it was issued as.", "NOT_A_PDF");
  res.setHeader("Cache-Control", "no-store");
  res.json(await checkLetter(file.buffer));
});
