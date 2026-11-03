import { LETTER_STARTERS, letterStarter } from "@shared/constants/letterStarters";
import { writeAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { createTemplate, updateTemplateSettings, type ActorMeta } from "./service";
import { payFreeProof } from "./template";

// A-9 G3 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 11). The starter gallery: original placeholder wording, loaded only by a director, one at a time,
// audited, never automatically. A loaded starter becomes an ordinary versioned template (the existing createTemplate) and is switched OFF until a director has
// rewritten it and switched it on. The gallery itself is code (shared/constants/letterStarters.ts); nothing is seeded into the database.

export const isDirectorViewer = (v: { roleCodes: string[] }) => v.roleCodes.includes("SUPER_ADMIN");

export function assertDirector(v: { roleCodes: string[] }, what: string) {
  if (!isDirectorViewer(v)) throw new HttpError(403, `Only a director can ${what}.`, "DIRECTOR_ONLY");
}

/**
 * The A-3 hook. Once A-3 (Session A: letter figures from the salary structure) lands, this returns the figure fields a pay-carrying letter takes from the
 * person's salary structure (read by the directors only). Until then it returns none, and a pay-carrying starter states no figure at all.
 */
export function letterFigureFields(_starterCode: string): ReadonlyArray<{ key: string; label: string }> {
  return [];
}

export async function listStarters(viewer: { roleCodes: string[] }) {
  assertDirector(viewer, "see the starter letters");
  const loaded = new Set((await prisma.letterTemplate.findMany({ where: { code: { in: LETTER_STARTERS.map((s) => s.code) } }, select: { code: true } })).map((t) => t.code));
  return LETTER_STARTERS.map((s) => ({
    code: s.code,
    name: s.name,
    description: s.description,
    carriesPay: s.carriesPay,
    // What the system itself concludes from the wording: only a director may issue a letter the check cannot prove pay-free.
    directorOnly: s.carriesPay || !payFreeProof(s.bodyHtml, s.extraFields).ok,
    loaded: loaded.has(s.code),
    bodyHtml: s.bodyHtml,
    extraFields: s.extraFields,
  }));
}

export async function loadStarter(code: string, viewer: { roleCodes: string[] }, meta: ActorMeta) {
  assertDirector(viewer, "load a starter letter");
  const starter = letterStarter(code);
  if (!starter) throw new HttpError(404, "There is no starter letter with that code.", "NOT_FOUND");
  // createTemplate refuses a duplicate code (409), so loading twice never makes two templates.
  const created = await createTemplate({ code: starter.code, name: starter.name, description: `STARTER: ${starter.description}`, visibleToEmployeeDefault: true, bodyHtml: starter.bodyHtml, extraFields: starter.extraFields }, meta);
  await updateTemplateSettings(created.id, { isActive: false }, meta);
  await writeAuditLog({ ...meta, action: "letters.starter.loaded", entityType: "LetterTemplate", entityId: created.id, after: { code: starter.code, carriesPay: starter.carriesPay, enabled: false } });
  return { id: created.id, code: starter.code, isActive: false };
}
