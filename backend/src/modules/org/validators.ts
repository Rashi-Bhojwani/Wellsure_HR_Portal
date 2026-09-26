import { z } from "zod";

// Org masters — spec §7.8. Code/name are unique per resource (DB-enforced,
// caught as a friendly 409 in service.ts).

export const idParamsSchema = z.object({ id: z.string().min(1) });

export const createCitySchema = z.object({
  name: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
});
export const updateCitySchema = createCitySchema.partial();

export const createLocationSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  cityId: z.string().min(1).nullable().optional(),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pincode: z.string().trim().min(4).max(10),
});
export const updateLocationSchema = createLocationSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export const mergeLocationSchema = z.object({
  intoLocationId: z.string().min(1),
});

export const createSimpleMasterSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
});
export const updateSimpleMasterSchema = createSimpleMasterSchema.partial();

export const createGradeSchema = createSimpleMasterSchema.extend({
  rank: z.number().int().min(0).max(999).optional(),
});
export const updateGradeSchema = createGradeSchema.partial();
