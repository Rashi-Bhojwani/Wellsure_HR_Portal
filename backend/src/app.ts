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
  app.use(pinoHttp({ logger }));

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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
