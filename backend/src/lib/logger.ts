import pino from "pino";
import { env } from "../config/env";
import { redact, scrubText } from "./redact";

// What the logger will not print (docs/plans/PHASE_6.md §14J): the keys redact() knows are masked wherever they appear in a logged object, and the message and stack of an error
// are scrubbed by pattern (an account-like run of digits, a PAN-shaped word). The HTTP request log is already an allowlist that carries no body (app.ts).
function errSerializer(err: unknown): unknown {
  const base = pino.stdSerializers.err(err as Error) as unknown as Record<string, unknown>;
  for (const k of ["message", "stack"]) if (typeof base[k] === "string") base[k] = scrubText(base[k] as string);
  return redact(base);
}

/** The parts of the logger's configuration that keep secrets out of what it prints; the sensitive-data scan builds a logger from exactly these. */
export const SAFE_LOG_OPTIONS = {
  serializers: { err: errSerializer, error: errSerializer },
  formatters: { log: (o: Record<string, unknown>) => redact(o) },
} satisfies pino.LoggerOptions;

export const logger = pino({
  level: env.APP_ENV === "production" ? "info" : "debug",
  ...SAFE_LOG_OPTIONS,
  transport:
    env.APP_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});
