import { Router } from "express";
import { memoryUpload } from "../../lib/uploads";
import { authenticate } from "../../middleware/authenticate";
import { requireAnyPermission, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import {
  createTemplateSchema,
  employeeIdParamsSchema,
  idParamsSchema,
  issueSchema,
  letterheadSchema,
  newVersionSchema,
  previewSchema,
  reissueSchema,
  updateTemplateSchema,
} from "./validators";

// Letters (spec §7.2, Phase 5 commit D2). Templates and the letterhead need
// letters.template.manage; issuing, reissuing and reproducing need
// letters.generate AND the employee in the caller's data scope (checked in
// the service — out of scope reads as 404).
export const lettersRouter = Router();
lettersRouter.use(authenticate);

const manage = requirePermission("letters.template.manage");
const generate = requirePermission("letters.generate");

lettersRouter.get("/templates", requireAnyPermission("letters.template.manage", "letters.generate"), controller.listTemplates);
lettersRouter.post("/templates", manage, validate({ body: createTemplateSchema }), controller.createTemplate);
lettersRouter.post("/templates/preview", manage, validate({ body: previewSchema }), controller.previewTemplate);
lettersRouter.get("/templates/:id", manage, validate({ params: idParamsSchema }), controller.getTemplate);
lettersRouter.patch("/templates/:id", manage, validate({ params: idParamsSchema, body: updateTemplateSchema }), controller.updateTemplate);
lettersRouter.post("/templates/:id/versions", manage, validate({ params: idParamsSchema, body: newVersionSchema }), controller.saveNewVersion);

lettersRouter.get("/letterhead", manage, controller.getLetterhead);
lettersRouter.put("/letterhead", manage, validate({ body: letterheadSchema }), controller.updateLetterhead);
lettersRouter.get("/letterhead/logo", manage, controller.getLogo);
lettersRouter.post("/letterhead/logo", manage, memoryUpload(2), controller.uploadLogo);
lettersRouter.delete("/letterhead/logo", manage, controller.removeLogo);

lettersRouter.get("/employees/:employeeId", generate, validate({ params: employeeIdParamsSchema }), controller.listEmployeeLetters);
lettersRouter.post("/employees/:employeeId", generate, validate({ params: employeeIdParamsSchema, body: issueSchema }), controller.issueLetter);
lettersRouter.get("/:id", generate, validate({ params: idParamsSchema }), controller.getLetter);
lettersRouter.post("/:id/reissue", generate, validate({ params: idParamsSchema, body: reissueSchema }), controller.reissueLetter);
lettersRouter.post("/:id/reproduce", generate, validate({ params: idParamsSchema }), controller.reproduceLetter);
