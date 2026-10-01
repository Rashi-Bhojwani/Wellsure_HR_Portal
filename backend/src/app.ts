import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { noStore } from "./middleware/noStore";
import { devStorageRouter } from "./integrations/storage";
import { authRouter } from "./modules/auth/routes";
import { orgRouter } from "./modules/org/routes";
import { employeeRouter } from "./modules/employee/routes";
import { importRouter } from "./modules/import/routes";
import { auditLogRouter } from "./modules/auditLog/routes";
import { settingsRouter } from "./modules/settings/routes";
import { holidaysRouter, leaveRouter } from "./modules/leave/routes";
import { notificationsRouter } from "./modules/notifications/routes";
import { announcementsRouter } from "./modules/announcements/routes";
import { adminRouter } from "./modules/admin/routes";
import { engageRouter } from "./modules/engage/routes";
import { peoplePhotosRouter, peopleRouter } from "./modules/people/routes";
import { documentsRouter } from "./modules/documents/routes";
import { helpdeskRouter } from "./modules/helpdesk/routes";
import { requestHubRouter } from "./modules/requestHub/routes";
import { tasksRouter } from "./modules/tasks/routes";
import { lettersRouter } from "./modules/letters/routes";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  // Auth/session and authenticated-data responses must never be cached —
  // see middleware/noStore.ts. Disabling etag app-wide is the actual fix
  // for the 304 (Express's conditional-GET short-circuit runs regardless
  // of Cache-Control); nothing in this API is a static asset a client
  // should conditionally re-fetch, so there's no downside to losing it
  // globally rather than trying to scope it away from just these routes.
  app.set("etag", false);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(","), credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  // Request logs are an allowlist. pino-http's default serializer logs every
  // request header — including `Authorization: Bearer <access token>` and
  // the refresh-token cookie — so credentials must never go through it.
  // The photo-only token (modules/people/photos.ts) travels in the query
  // string because <img> can't send headers, so it's redacted from the URL.
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req: (req: { id?: unknown; method: string; url: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.replace(/([?&]t=)[^&]*/g, "$1[redacted]"),
          remoteAddress: req.remoteAddress,
        }),
      },
    }),
  );

  // Liveness — the process is up. Never checks dependencies.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Readiness — the process can actually serve traffic (DB + Redis reachable).
  app.get("/ready", async (_req, res) => {
    const [dbOk, redisOk] = await Promise.all([
      prisma
        .$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false),
      redis
        .ping()
        .then(() => true)
        .catch(() => false),
    ]);

    if (dbOk && redisOk) {
      res.status(200).json({ status: "ok", db: dbOk, redis: redisOk });
    } else {
      res.status(503).json({ status: "unavailable", db: dbOk, redis: redisOk });
    }
  });

  // Serves LocalStorageService's simulated signed URLs — see
  // src/integrations/storage/devRoute.ts. Inert under STORAGE_DRIVER=s3.
  app.use(devStorageRouter);
  // Employee photos: cacheable image bytes, authenticated by the photo-only
  // token (modules/people/photos.ts), not the Authorization header. Mounted
  // before every /api router because holidaysRouter is mounted at bare /api
  // and runs `authenticate` for any /api/* request that reaches it.
  app.use("/api/people/photos", peoplePhotosRouter);

  // Module routes (auth, employees, attendance, ...) are mounted here
  // starting Phase 1 — see src/modules/*/README.md.
  app.use("/api/auth", noStore, authRouter);
  app.use("/api/org", noStore, orgRouter);
  app.use("/api/employees", noStore, employeeRouter);
  app.use("/api/import", noStore, importRouter);
  app.use("/api/audit-logs", noStore, auditLogRouter);
  app.use("/api/settings", noStore, settingsRouter);
  app.use("/api/leave", noStore, leaveRouter);
  app.use("/api", noStore, holidaysRouter);
  app.use("/api/notifications", noStore, notificationsRouter);
  app.use("/api/announcements", noStore, announcementsRouter);
  app.use("/api/admin", noStore, adminRouter);
  app.use("/api/engage", noStore, engageRouter);
  app.use("/api/people", noStore, peopleRouter);
  app.use("/api/documents", noStore, documentsRouter);
  app.use("/api/helpdesk", noStore, helpdeskRouter);
  app.use("/api/request-hub", noStore, requestHubRouter);
  app.use("/api/tasks", noStore, tasksRouter);
  app.use("/api/letters", noStore, lettersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
