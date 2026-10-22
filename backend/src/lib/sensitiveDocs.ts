import { PERMISSION_CATALOG, type PermissionKey } from "@shared/constants/permissions";
import { DEVELOPER_ROLE_CODE, DEVELOPER_FORBIDDEN_KEYS, SENSITIVE_CLASSES } from "@shared/constants/sensitiveData";
import { SYSTEM_ROLES } from "./systemRoles";

// The tables in docs/SENSITIVE_DATA.md, made from the registry and the default roles, so the document cannot say something the code does not. A test (lib/__tests__/sensitiveDocs.test.ts)
// regenerates them and fails if the document differs; `npm run docs:sensitive --prefix backend` prints them for pasting between the markers.

export const BEGIN = "<!-- BEGIN GENERATED: do not edit by hand; npm run docs:sensitive --prefix backend -->";
export const END = "<!-- END GENERATED -->";

const label = (k: PermissionKey) => PERMISSION_CATALOG[k].label;
const list = (keys: readonly PermissionKey[]) => (keys.length === 0 ? "nobody by permission" : keys.map(label).join("; "));

export function sensitiveMarkdown(): string {
  const lines: string[] = [BEGIN, "", "#### Which permission opens each kind of data", "", "| Kind of data | What it is | See it | Change it | Confirm it |", "|---|---|---|---|---|"];
  for (const c of SENSITIVE_CLASSES) lines.push(`| ${c.label} | ${c.what} | ${list(c.view)} | ${list(c.edit)} | ${list(c.confirm)} |`);

  lines.push("", "#### What each default role can do with each kind (S = see, C = change, K = confirm; a role's permissions are the Super Admins' to edit, so this is the starting point)", "");
  lines.push(`| Role | ${SENSITIVE_CLASSES.map((c) => c.label).join(" | ")} |`, `|---|${SENSITIVE_CLASSES.map(() => "---").join("|")}|`);
  for (const role of SYSTEM_ROLES) {
    const held = new Set<string>(role.code === "SUPER_ADMIN" ? SENSITIVE_CLASSES.flatMap((c) => [...c.view, ...c.edit, ...c.confirm]) : role.permissions);
    if (role.code === DEVELOPER_ROLE_CODE) for (const k of DEVELOPER_FORBIDDEN_KEYS) held.delete(k); // the ceiling, applied where access is resolved
    const cells = SENSITIVE_CLASSES.map((c) => {
      const marks = `${c.view.some((k) => held.has(k)) ? "S" : ""}${c.edit.some((k) => held.has(k)) ? "C" : ""}${c.confirm.some((k) => held.has(k)) ? "K" : ""}`;
      return marks === "" ? "—" : marks;
    });
    lines.push(`| ${role.name} | ${cells.join(" | ")} |`);
  }
  lines.push("", END);
  return lines.join("\n");
}
