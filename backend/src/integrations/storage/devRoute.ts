import { Router } from "express";
import { readFile } from "node:fs/promises";
import { localStorageFilePath, readLocalObjectMeta, verifyLocalSignedUrl } from "./LocalStorageService";
import { HttpError } from "../../middleware/errorHandler";
import { attachmentContentDisposition } from "./StorageService";

// Serves LocalStorageService's simulated signed URLs
// (GET /dev/storage?key=...&exp=...&sig=...). Only meaningful when
// STORAGE_DRIVER=local — mounted unconditionally since it's inert
// otherwise (nothing generates URLs pointing at it under STORAGE_DRIVER=s3).
export const devStorageRouter = Router();

devStorageRouter.get("/dev/storage", async (req, res, next) => {
  try {
    const key = typeof req.query.key === "string" ? req.query.key : "";
    const exp = Number(req.query.exp);
    const sig = typeof req.query.sig === "string" ? req.query.sig : "";
    const downloadFileName = typeof req.query.dn === "string" ? req.query.dn : "";

    if (!key || !sig || !verifyLocalSignedUrl(key, exp, sig, downloadFileName)) {
      throw new HttpError(403, "Invalid or expired signed URL");
    }

    const { contentType } = await readLocalObjectMeta(key);
    const data = await readFile(localStorageFilePath(key));
    res.setHeader("Content-Type", contentType);
    if (downloadFileName) res.setHeader("Content-Disposition", attachmentContentDisposition(downloadFileName));
    res.send(data);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      next(new HttpError(404, "Object not found"));
      return;
    }
    next(err);
  }
});
