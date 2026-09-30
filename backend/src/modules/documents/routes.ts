import { Router } from "express";
import { MAX_DOCUMENT_UPLOAD_MB_CEILING } from "@shared/constants/peopleDocuments";
import { memoryUpload } from "../../lib/uploads";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import {
  createCategorySchema,
  employeeIdParamsSchema,
  idParamsSchema,
  listCategoriesQuerySchema,
  listManagedCompanyDocumentsQuerySchema,
  updateCategorySchema,
  updateCompanyDocumentSchema,
  updateEmployeeDocumentSchema,
  uploadCompanyDocumentSchema,
  uploadEmployeeDocumentSchema,
} from "./validators";

// Document Center (spec §6) and HR-held employee documents (spec §7.2).
// Reading company documents and your own visible documents is self-serve;
// everything else is permission-gated at the route AND, for another
// employee's documents, data-scope checked in the service (IDOR rule).
// Uploads: multer runs before body validation (it's what parses the
// multipart fields), capped at the hard ceiling; the admin-set limit and
// type checks happen per request in lib/uploads.ts.
export const documentsRouter = Router();
documentsRouter.use(authenticate);

const manageDocuments = requirePermission("documents.manage");
const viewEmployeeDocs = requirePermission("employee.documents.view");
const manageEmployeeDocs = requirePermission("employee.documents.manage");
const upload = memoryUpload(MAX_DOCUMENT_UPLOAD_MB_CEILING);

documentsRouter.get("/categories", validate({ query: listCategoriesQuerySchema }), controller.listCategories);
documentsRouter.post("/categories", manageDocuments, validate({ body: createCategorySchema }), controller.createCategory);
documentsRouter.patch("/categories/:id", manageDocuments, validate({ params: idParamsSchema, body: updateCategorySchema }), controller.updateCategory);

documentsRouter.get("/company", controller.listCompanyDocuments);
documentsRouter.get("/company/manage", manageDocuments, validate({ query: listManagedCompanyDocumentsQuerySchema }), controller.listManagedCompanyDocuments);
documentsRouter.post("/company", manageDocuments, upload, validate({ body: uploadCompanyDocumentSchema }), controller.uploadCompanyDocument);
documentsRouter.patch("/company/:id", manageDocuments, validate({ params: idParamsSchema, body: updateCompanyDocumentSchema }), controller.updateCompanyDocument);
documentsRouter.post("/company/:id/archive", manageDocuments, validate({ params: idParamsSchema }), controller.archiveCompanyDocument);
documentsRouter.post("/company/:id/unarchive", manageDocuments, validate({ params: idParamsSchema }), controller.unarchiveCompanyDocument);
documentsRouter.post("/company/:id/download", validate({ params: idParamsSchema }), controller.downloadCompanyDocument);
documentsRouter.get("/company/:id/downloads", manageDocuments, validate({ params: idParamsSchema }), controller.getCompanyDocumentDownloads);

documentsRouter.get("/me", controller.listMyDocuments);
documentsRouter.post("/me/:id/download", validate({ params: idParamsSchema }), controller.downloadMyDocument);

documentsRouter.get("/employees/:employeeId", viewEmployeeDocs, validate({ params: employeeIdParamsSchema }), controller.listEmployeeDocuments);
documentsRouter.post(
  "/employees/:employeeId",
  manageEmployeeDocs,
  validate({ params: employeeIdParamsSchema }),
  upload,
  validate({ body: uploadEmployeeDocumentSchema }),
  controller.uploadEmployeeDocument,
);
documentsRouter.patch(
  "/employee-documents/:id",
  manageEmployeeDocs,
  validate({ params: idParamsSchema, body: updateEmployeeDocumentSchema }),
  controller.updateEmployeeDocument,
);
documentsRouter.post("/employee-documents/:id/archive", manageEmployeeDocs, validate({ params: idParamsSchema }), controller.archiveEmployeeDocument);
documentsRouter.post("/employee-documents/:id/unarchive", manageEmployeeDocs, validate({ params: idParamsSchema }), controller.unarchiveEmployeeDocument);
documentsRouter.post("/employee-documents/:id/download", viewEmployeeDocs, validate({ params: idParamsSchema }), controller.downloadEmployeeDocument);
