import { z } from "zod";
import { DASHBOARD_WIDGET_KEYS } from "./layout";

export const idParamsSchema = z.object({ id: z.string().min(1) });

export const createFavouriteSchema = z.object({
  label: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(60),
  path: z.string().trim().min(1).max(200),
});

export const reorderFavouritesSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).max(50),
});

export const saveLayoutSchema = z.object({
  layout: z
    .array(
      z.object({
        key: z.enum(DASHBOARD_WIDGET_KEYS),
        visible: z.boolean(),
      }),
    )
    .min(1)
    .max(DASHBOARD_WIDGET_KEYS.length),
});
