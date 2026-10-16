import { readdirSync } from "node:fs";
import path from "node:path";
import { GetAccountSendingEnabledCommand, GetIdentityVerificationAttributesCommand, GetSendQuotaCommand, SESClient } from "@aws-sdk/client-ses";
import { ListSubscriptionsByTopicCommand, SNSClient } from "@aws-sdk/client-sns";
import { PERMISSION_KEYS } from "@shared/constants/permissions";
import { env } from "../config/env";
import { leastPrivilegeProblems } from "./dbRoles";
import { decryptField, encryptField } from "./encryption";
import { prisma } from "./prisma";
import { SYSTEM_ROLES } from "./systemRoles";

// `npm run admin:preflight` (Phase 1.5, commit A): is this environment ready to have its first administrator created, and to be trusted with real
// data? Every check only reads (the one exception, a test email, happens only when the operator asks for it with --send-test). The ALERTING checks
// are also the gate in front of admin:bootstrap: an environment that cannot tell anyone a break-glass account was made must not make one.

export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export type CheckResult = { id: string; label: string; status: CheckStatus; detail: string; alerting: boolean };

export interface PreflightProbes {
  /** Migration directories shipped in this image, and the ones the database has finished. */
  migrations(): Promise<{ shipped: string[]; finished: string[]; unfinished: string[] }>;
  /** Permission keys and system roles present in the database. */
  catalog(): Promise<{ permissionKeys: string[]; roleCodes: string[] }>;
  /** SES: is the address (or its domain) a verified sender, is sending enabled, and the 24-hour quota (200 means the sandbox). */
  sesSender(address: string): Promise<{ verified: boolean; sendingEnabled: boolean; max24HourSend: number }>;
  /** SES: is the recipient a verified identity (needed while the account is in the sandbox). */
  sesRecipientVerified(address: string): Promise<boolean>;
  /** SNS: subscriptions on the break-glass alarm topic that have been confirmed, and that are still pending. */
  topicSubscriptions(topicArn: string): Promise<{ confirmed: number; pending: number }>;
  /** The database role this connection runs as: anything that makes it more than least-privilege. */
  databaseRoleProblems(): Promise<string[]>;
  /** Encrypts and decrypts a throwaway value with the loaded data keys. */
  encryptionRoundTrip(): Promise<boolean>;
}

const SES_SANDBOX_QUOTA = 200;

export function compareMigrations(shipped: string[], finished: string[], unfinished: string[]): { pending: string[]; unfinished: string[] } {
  const done = new Set(finished);
  return { pending: shipped.filter((m) => !done.has(m)), unfinished };
}

type Subject = { appEnv: string; sesFrom?: string | undefined; securityAlertEmail?: string | undefined; breakGlassTopicArn?: string | undefined };

export async function runPreflight(subject: Subject, probes: PreflightProbes, opts: { alertingOnly?: boolean } = {}): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const add = (id: string, label: string, alerting: boolean, status: CheckStatus, detail: string): void => {
    if (opts.alertingOnly && !alerting) return;
    out.push({ id, label, status, detail, alerting });
  };
  const attempt = async (id: string, label: string, alerting: boolean, fn: () => Promise<[CheckStatus, string]>): Promise<void> => {
    if (opts.alertingOnly && !alerting) return;
    try {
      const [status, detail] = await fn();
      add(id, label, alerting, status, detail);
    } catch (err) {
      add(id, label, alerting, "fail", `could not check: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const deployed = subject.appEnv !== "development";

  await attempt("migrations", "Every migration has been applied", false, async () => {
    const m = await probes.migrations();
    const { pending, unfinished } = compareMigrations(m.shipped, m.finished, m.unfinished);
    if (unfinished.length) return ["fail", `migration(s) started but not finished: ${unfinished.join(", ")}`];
    if (pending.length) return ["fail", `${pending.length} migration(s) not applied yet (${pending.slice(0, 3).join(", ")}${pending.length > 3 ? "..." : ""}): the migrate task has not run, or failed`];
    return ["pass", `${m.shipped.length} migrations applied`];
  });

  await attempt("catalog", "Permission catalog and system roles exist", false, async () => {
    const c = await probes.catalog();
    const missingKeys = PERMISSION_KEYS.filter((k) => !c.permissionKeys.includes(k));
    const missingRoles = SYSTEM_ROLES.map((r) => r.code).filter((r) => !c.roleCodes.includes(r));
    if (missingKeys.length || missingRoles.length) return ["fail", `missing ${missingKeys.length} permission(s) and ${missingRoles.length} role(s): the migrate task creates them`];
    return ["pass", `${PERMISSION_KEYS.length} permissions, ${SYSTEM_ROLES.length} system roles`];
  });

  await attempt("encryption", "Field encryption keys load and work", false, async () => ((await probes.encryptionRoundTrip()) ? ["pass", "a throwaway value encrypted and decrypted"] : ["fail", "round trip returned a different value"]));

  await attempt("db-role", "The app's database role is least-privilege", false, async () => {
    if (!deployed) return ["skip", "development runs as a single database role by design"];
    const problems = await probes.databaseRoleProblems();
    return problems.length ? ["fail", problems.join("; ")] : ["pass", "cannot change the schema or rewrite audit_logs / security_events"];
  });

  await attempt("alert-email", "SECURITY_ALERT_EMAIL is set", true, async () => (subject.securityAlertEmail ? ["pass", "set"] : ["fail", "not set: nobody outside this system would hear of a break-glass account"]));

  await attempt("ses-sender", "SES can send from the configured address", true, async () => {
    if (!deployed) return ["skip", "development writes mail to files"];
    if (!subject.sesFrom) return ["fail", "SES_FROM is not set"];
    const s = await probes.sesSender(subject.sesFrom);
    if (!s.verified) return ["fail", `${subject.sesFrom} (or its domain) is not a verified SES sender in this region`];
    if (!s.sendingEnabled) return ["fail", "SES sending is disabled for this account"];
    return s.max24HourSend <= SES_SANDBOX_QUOTA
      ? ["warn", `verified, but the account is in the SES sandbox (limit ${s.max24HourSend}/day): mail reaches verified addresses only. Request production access before inviting anyone`]
      : ["pass", `verified; production access (limit ${s.max24HourSend}/day)`];
  });

  await attempt("alert-deliverable", "The security alert address can receive mail from SES", true, async () => {
    if (!deployed) return ["skip", "development writes mail to files"];
    if (!subject.securityAlertEmail) return ["fail", "SECURITY_ALERT_EMAIL is not set"];
    const s = await probes.sesSender(subject.sesFrom ?? "");
    if (s.max24HourSend > SES_SANDBOX_QUOTA) return ["pass", "production access: any address; run with --send-test to prove this inbox gets a message"];
    return (await probes.sesRecipientVerified(subject.securityAlertEmail))
      ? ["pass", "sandbox, and the address is a verified identity"]
      : ["fail", "the account is in the SES sandbox and this address is not a verified identity, so the alert would be refused"];
  });

  await attempt("breakglass-alarm", "The break-glass alarm has a confirmed subscriber", true, async () => {
    if (!deployed) return ["skip", "development has no alarms"];
    if (!subject.breakGlassTopicArn) return ["fail", "BREAKGLASS_ALARM_TOPIC_ARN is not set"];
    const t = await probes.topicSubscriptions(subject.breakGlassTopicArn);
    if (t.confirmed > 0) return ["pass", `${t.confirmed} confirmed subscription(s)`];
    return ["fail", t.pending > 0 ? `${t.pending} subscription(s) are waiting for the recipient to click the confirmation email` : "no subscriptions: the alarm would ring in an empty room"];
  });

  return out;
}

export const blockingFailures = (results: CheckResult[]): CheckResult[] => results.filter((r) => r.status === "fail");

/** What admin:bootstrap is refused with when the environment cannot alert. Null means it can (or it is development). */
export async function bootstrapRefusal(subject: Subject, probes: PreflightProbes): Promise<string | null> {
  if (subject.appEnv === "development") return null;
  const failures = blockingFailures(await runPreflight(subject, probes, { alertingOnly: true }));
  if (failures.length === 0) return null;
  return [
    "This environment cannot tell anyone that a break-glass account was created, so none will be created here:",
    ...failures.map((f) => `  - ${f.label}: ${f.detail}`),
    "Fix these (npm run admin:preflight shows the full list), then run admin:bootstrap again.",
  ].join("\n");
}

// ── The real probes ──

export function awsProbes(clients: { ses?: Pick<SESClient, "send">; sns?: Pick<SNSClient, "send"> } = {}): PreflightProbes {
  const ses = clients.ses ?? new SESClient({ region: env.AWS_REGION });
  const sns = clients.sns ?? new SNSClient({ region: env.AWS_REGION });
  const identities = (address: string): string[] => [address, address.split("@")[1] ?? address];
  return {
    async migrations() {
      const dir = path.resolve(import.meta.dirname, "../../prisma/migrations");
      const shipped = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
      const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
      return {
        shipped,
        finished: rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name),
        unfinished: rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name),
      };
    },
    async catalog() {
      const [permissions, roles] = await Promise.all([prisma.permission.findMany({ select: { key: true } }), prisma.role.findMany({ select: { code: true } })]);
      return { permissionKeys: permissions.map((p) => p.key), roleCodes: roles.map((r) => r.code) };
    },
    async sesSender(address) {
      const [attrs, enabled, quota] = await Promise.all([
        ses.send(new GetIdentityVerificationAttributesCommand({ Identities: identities(address) })),
        ses.send(new GetAccountSendingEnabledCommand({})),
        ses.send(new GetSendQuotaCommand({})),
      ]);
      const verified = identities(address).some((i) => attrs.VerificationAttributes?.[i]?.VerificationStatus === "Success");
      return { verified, sendingEnabled: enabled.Enabled === true, max24HourSend: quota.Max24HourSend ?? 0 };
    },
    async sesRecipientVerified(address) {
      const attrs = await ses.send(new GetIdentityVerificationAttributesCommand({ Identities: identities(address) }));
      return identities(address).some((i) => attrs.VerificationAttributes?.[i]?.VerificationStatus === "Success");
    },
    async topicSubscriptions(topicArn) {
      let confirmed = 0;
      let pending = 0;
      let next: string | undefined;
      do {
        const page = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn, NextToken: next }));
        for (const s of page.Subscriptions ?? []) {
          if (s.SubscriptionArn === "PendingConfirmation") pending += 1;
          else confirmed += 1;
        }
        next = page.NextToken;
      } while (next);
      return { confirmed, pending };
    },
    databaseRoleProblems: () => leastPrivilegeProblems(prisma),
    async encryptionRoundTrip() {
      const probe = `preflight-${Date.now()}`;
      return decryptField(encryptField(probe)) === probe;
    },
  };
}
