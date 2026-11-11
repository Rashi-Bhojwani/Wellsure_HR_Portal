import { z } from "zod";

/** Free text next to an offer or joining record is read by non-directors, so it may not carry a pay figure. */
export const PAY_LIKE = /(salary|compensation|\bctc\b|\binr\b|₹|\brs\.?\s|\blakh|\blpa\b|\bpay\b|\bstipend|\d{4,})/i;
export const noPayReason = (max: number) => z.string().trim().min(1).max(max).refine(v => !PAY_LIKE.test(v), "Leave pay figures out of this text; only a director records pay.");
