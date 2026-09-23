import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { devStorageRouter } from "./integrations/storage";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(","), credentials: true }));
  app.use(express.json());
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
