import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { batchIdParamsSchema, commitBodySchema, datasetParamsSchema, listBatchesQuerySchema } from "./validators";

// Import Center (spec §10). Every route needs import.manage; the bank
// dataset additionally needs employee.bank.edit, checked in the service
// once the dataset is known (see service.ts's uploadAndValidate/commitBatch)
// rather than in route middleware, since the commit route (/batches/:id/
// commit) has no :dataset URL segment to key a static check off of.
export const importRouter = Router();
importRouter.use(authenticate);

const manage = requirePermission("import.manage");

// Memory storage only — files are parsed into staging rows immediately and
// never written to disk; 10MB comfortably covers a multi-thousand-row
// spreadsheet of the column widths this module uses.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const okType =
      file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || file.originalname.toLowerCase().endsWith(".xlsx");
    if (okType) cb(null, true);
    else cb(new Error("Only .xlsx files are accepted."));
  },
});

importRouter.get("/:dataset/template", manage, validate({ params: datasetParamsSchema }), controller.downloadTemplate);
importRouter.post("/:dataset/upload", manage, validate({ params: datasetParamsSchema }), upload.single("file"), controller.upload);

importRouter.get("/reconciliation", manage, controller.reconciliationReport);

importRouter.get("/batches", manage, validate({ query: listBatchesQuerySchema }), controller.listBatches);
importRouter.get("/batches/:id", manage, validate({ params: batchIdParamsSchema }), controller.getBatch);
importRouter.get("/batches/:id/error-report", manage, validate({ params: batchIdParamsSchema }), controller.downloadErrorReport);
importRouter.post("/batches/:id/commit", manage, validate({ params: batchIdParamsSchema, body: commitBodySchema }), controller.commitBatch);
