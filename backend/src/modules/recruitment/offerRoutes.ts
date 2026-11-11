import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import { memoryUpload } from "../../lib/uploads";
import { metaOf, requireUser } from "./access";
import { changed } from "./signals";
import * as offers from "./offers";
import * as joining from "./joining";
import * as conversion from "./conversion";
import * as referrals from "./referrals";

// C-4B routes (offers, pay, joining, conversion, referrals). Signed-in routes live under /api/recruitment next to C-4A's;
// the joiner link is the only public surface, under /api/joining, and reveals nothing beyond its upload page.
export const offerRouter = Router();
offerRouter.use(authenticate, requireUser);
const empty = z.object({}).strict();
const idSchema = z.object({ id: z.string().min(1).max(100) }).strict();
const id = (p: unknown) => (p as { id: string }).id;

offerRouter.get("/offer-status", validate({ query: empty }), async (req, res) => { res.json(await joining.offerStatus(req.user!)); });
offerRouter.get("/offers", validate({ query: offers.offerListInput }), async (req, res) => { res.json(await offers.listOffers(req.user!, req.query as never)); });
offerRouter.post("/offers", validate({ body: offers.offerInput }), async (req, res) => { res.status(201).json(await changed(offers.createOffer(req.user!, req.body, metaOf(req)), r => ({ candidateId: r.candidate.id }))); });
offerRouter.get("/offers/:id", validate({ params: idSchema, query: empty }), async (req, res) => { res.json(await offers.getOffer(id(req.params), req.user!)); });
offerRouter.post("/offers/:id/state", validate({ params: idSchema, body: offers.transitionInput }), async (req, res) => { res.json(await changed(offers.transition(id(req.params), req.user!, req.body, metaOf(req)), r => ({ candidateId: r.candidate.id }))); });
offerRouter.get("/offers/:id/compensation", validate({ params: idSchema, query: empty }), async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(await offers.getCompensation(id(req.params), req.user!, metaOf(req))); });
offerRouter.put("/offers/:id/compensation", validate({ params: idSchema, body: offers.payInput }), async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(await offers.setCompensation(id(req.params), req.user!, req.body, metaOf(req))); });
offerRouter.get("/candidates/:id/expected-pay", validate({ params: idSchema, query: empty }), async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(await offers.getExpectedPay(id(req.params), req.user!, metaOf(req))); });
offerRouter.put("/candidates/:id/expected-pay", validate({ params: idSchema, body: offers.expectedPayInput }), async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(await offers.setExpectedPay(id(req.params), req.user!, req.body, metaOf(req))); });

offerRouter.get("/candidates/:id/joining", validate({ params: idSchema, query: empty }), async (req, res) => { res.json(await joining.joiningStatus(id(req.params), req.user!)); });
offerRouter.post("/candidates/:id/joiner-links", validate({ params: idSchema, body: empty }), async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.status(201).json(await joining.createLink(id(req.params), req.user!, metaOf(req))); });
offerRouter.post("/joiner-links/:id/revoke", validate({ params: idSchema, body: empty }), async (req, res) => { res.json(await joining.revokeLink(id(req.params), req.user!, metaOf(req))); });
offerRouter.post("/candidates/:id/joining-exceptions", validate({ params: idSchema, body: joining.exceptionInput }), async (req, res) => { res.status(201).json(await joining.grantException(id(req.params), req.user!, req.body, metaOf(req))); });
offerRouter.get("/joining-documents/:id/file", validate({ params: idSchema, query: empty }), async (req, res) => {
  const object = await joining.downloadDocument(id(req.params), req.user!, metaOf(req));
  res.setHeader("Content-Type", object.contentType);
  res.setHeader("Content-Disposition", 'attachment; filename="joining-document"');
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.send(object.body);
});

offerRouter.get("/offers/:id/conversion", validate({ params: idSchema, query: empty }), async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(await conversion.conversionPrefill(id(req.params), req.user!)); });
offerRouter.post("/offers/:id/conversion", validate({ params: idSchema, body: conversion.convertInput }), async (req, res) => { const r = await conversion.convert(id(req.params), req.user!, req.body, metaOf(req)); res.status(r.created ? 201 : 200).json(r); });

offerRouter.get("/referrals/status", validate({ query: empty }), async (req, res) => { res.json(await referrals.referralStatus(req.user!)); });
offerRouter.get("/referrals/jobs", validate({ query: empty }), async (req, res) => { res.json(await referrals.openJobs(req.user!)); });
offerRouter.get("/referrals/mine", validate({ query: empty }), async (req, res) => { res.json(await referrals.mine(req.user!)); });
offerRouter.post("/referrals", validate({ body: referrals.referralInput }), async (req, res) => { res.status(201).json(await referrals.submit(req.user!, req.body, metaOf(req))); });
offerRouter.get("/referrals", validate({ query: empty }), async (req, res) => { res.json(await referrals.list(req.user!)); });
offerRouter.post("/referrals/:id/accept", validate({ params: idSchema, body: referrals.acceptInput }), async (req, res) => { res.json(await referrals.accept(id(req.params), req.user!, req.body, metaOf(req))); });
offerRouter.post("/referrals/:id/close", validate({ params: idSchema, body: empty }), async (req, res) => { res.json(await referrals.close(id(req.params), req.user!, metaOf(req))); });

// ── Public joiner link: no login, no cookie, rate-limited before anything is read. ──
export const joiningPublicRouter = Router();
joiningPublicRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); next(); });
const tokenOnly = joining.tokenParams;
const tokenAndType = z.object({ token: tokenOnly.shape.token, typeCode: z.string().regex(/^[A-Z0-9_]{1,60}$/) }).strict();
const limited = async (req: Parameters<typeof joining.limitPublic>[0], _res: unknown, next: (e?: unknown) => void) => {
  try { await joining.limitPublic(req, joining.hashToken(String(req.params.token ?? ""))); next(); } catch (e) { next(e); }
};
joiningPublicRouter.get("/:token", limited, validate({ params: tokenOnly, query: empty }), async (req, res) => { res.json(await joining.publicView(String(req.params.token))); });
joiningPublicRouter.post("/:token/documents/:typeCode", limited, validate({ params: tokenAndType }), memoryUpload(25), async (req, res) => {
  res.status(201).json(await joining.publicUpload(String(req.params.token), String(req.params.typeCode), req.file, { ipAddress: req.ip, userAgent: req.headers["user-agent"] }));
});
