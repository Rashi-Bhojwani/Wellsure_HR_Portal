import { TEXT_MESSAGE_CATEGORIES } from "@shared/constants/policySettings";
import { messageService } from "../../integrations/messages";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { policyInForce } from "../policySettings/service";

// M session block 2, NT-11: a copy of some notices by SMS or WhatsApp, only once the directors choose a provider and the notices (policy.textMessages,
// Not set: nothing is sent). The text carries the notice's title only, never its body (a body can name a reason or a figure). Failures never stop the
// in-app notice.
export async function maybeTextMessage(employeeId: string, type: string, title: string): Promise<boolean> {
  try {
    const p = await policyInForce<{ provider: "NONE" | "SMS" | "WHATSAPP"; categories: string[] }>("policy.textMessages");
    if (!p || p.provider === "NONE") return false;
    const covered = TEXT_MESSAGE_CATEGORIES.filter((c) => p.categories.includes(c.code)).some((c) => (c.types as readonly string[]).includes(type));
    if (!covered) return false;
    const personal = await prisma.employeePersonal.findUnique({ where: { employeeId }, select: { mobile: true } });
    if (!personal?.mobile || personal.mobile === "Erased") return false;
    await messageService.send({ channel: p.provider, to: personal.mobile, body: `${title}. Open the HR portal for details.` });
    return true;
  } catch (err) {
    logger.error({ err, type }, "text message not sent");
    return false;
  }
}
