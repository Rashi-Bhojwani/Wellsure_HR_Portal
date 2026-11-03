import { prisma } from "../../lib/prisma";
import { resolveAccess } from "../../lib/permissions";
import { createCategory, raiseTicket } from "./service";
import { setVisibility } from "./categoryVisibility";

// Explicit fictional choices in the DEMO company only, never a business preset.
export async function seedDemoHelpdesk(who: Record<string, { employeeId: string; userId: string }>) {
  const director = { ...who.DEMO001!, permissions: (await resolveAccess(who.DEMO001!.userId)).permissions };
  const raiser = { ...who.DEMO006!, permissions: (await resolveAccess(who.DEMO006!.userId)).permissions };
  for (const [code, marker, handlers] of [
    ["DEMO_C2_PRIVATE", "DEMO-C2-PRIVATE", [who.DEMO001!.employeeId]],
    ["DEMO_C2_HR", "DEMO-C2-HR-VISIBLE", [who.DEMO004!.employeeId]],
  ] as const) {
    if (await prisma.helpdeskCategory.count({ where: { code } })) continue;
    const category = await createCategory({ code, name: `DEMO ${code === "DEMO_C2_PRIVATE" ? "Private team" : "HR team"}` }, { actorUserId: director.userId });
    await setVisibility(category.id, { hrRoleCodes: [], employeeIds: [...handlers], version: 0, reason: "DEMO COMPANY: fictional visibility choice" }, director, { actorUserId: director.userId });
    await raiseTicket(raiser, { categoryId: category.id, subject: marker, body: "DEMO COMPANY: fictional ticket for confidentiality checks" }, [], { actorUserId: raiser.userId });
  }
}
