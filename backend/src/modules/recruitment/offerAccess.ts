import { HttpError } from "../../middleware/errorHandler";
import { context, type Actor } from "./access";

// C-4B audiences (owner decisions D-28 to D-30), built on the C-4A recruitment context:
//   offerManage — directors and Wellsure Office members with the recruitment capability while a director opens the Office audience.
//                 They create offers and record non-pay states. HR is never here: HR's recruitment duty (MANAGE_RECRUITMENT)
//                 reaches jobs/candidates/stages only.
//   payDirector — directors only: offer compensation, candidate expected pay, approve and issue.
//   onboarding  — directors, and HR while the RUN_ONBOARDING switch is not OFF (default ON). Joining checks, joining documents
//                 (identity and bank documents included) and conversion; reads only the non-pay terms of accepted offers.
//   Developer   — refused by context() before anything is read.
export async function offerContext(actor: Actor) {
  const c = await context(actor);
  // The HR role holds recruitment.onboarding by default; the RUN_ONBOARDING switch (resolveAccess) removes it when OFF.
  const onboarding = c.isDirector || (c.hr && c.permissions.has("recruitment.onboarding"));
  const offerManage = c.isDirector || c.office;
  return { ...c, onboarding, offerManage, payDirector: c.isDirector };
}
export type OfferContext = Awaited<ReturnType<typeof offerContext>>;

export async function requireOfferManage(actor: Actor) {
  const c = await offerContext(actor);
  if (!c.offerManage) throw new HttpError(403, "Offers are managed by the Wellsure Office and the directors.", "FORBIDDEN");
  return c;
}
export async function requireOnboarding(actor: Actor) {
  const c = await offerContext(actor);
  if (!c.onboarding) throw new HttpError(403, "Joining is handled by HR onboarding and the directors.", "FORBIDDEN");
  return c;
}
export async function requirePayDirector(actor: Actor) {
  const c = await offerContext(actor);
  if (!c.payDirector) throw new HttpError(403, "Only a director can see or change pay.", "FORBIDDEN");
  return c;
}
