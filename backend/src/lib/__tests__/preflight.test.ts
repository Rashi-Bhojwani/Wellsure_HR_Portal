import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "@shared/constants/permissions";
import { awsProbes, blockingFailures, bootstrapRefusal, compareMigrations, runPreflight, type PreflightProbes } from "../preflight";
import { SYSTEM_ROLES } from "../systemRoles";

const healthy = (): PreflightProbes => ({
  migrations: async () => ({ shipped: ["20260101_a", "20260102_b"], finished: ["20260101_a", "20260102_b"], unfinished: [] }),
  catalog: async () => ({ permissionKeys: [...PERMISSION_KEYS], roleCodes: SYSTEM_ROLES.map((r) => r.code) }),
  sesSender: async () => ({ verified: true, sendingEnabled: true, max24HourSend: 50_000 }),
  sesRecipientVerified: async () => true,
  topicSubscriptions: async () => ({ confirmed: 1, pending: 0 }),
  databaseRoleProblems: async () => [],
  encryptionRoundTrip: async () => true,
  developmentSeedPresent: async () => false,
  demoCompanyPresent: async () => false,
});
const staging = { appEnv: "staging", sesFrom: "no-reply@example.org", securityAlertEmail: "owners@example.org", breakGlassTopicArn: "arn:aws:sns:ap-south-1:1:breakglass" };
const byId = (rs: Awaited<ReturnType<typeof runPreflight>>) => Object.fromEntries(rs.map((r) => [r.id, r]));

describe("preflight", () => {
  it("passes a healthy environment", async () => {
    const r = await runPreflight(staging, healthy());
    expect(blockingFailures(r)).toEqual([]);
    expect(r.map((x) => x.id)).toEqual(["migrations", "catalog", "encryption", "demo-data", "demo-company", "db-role", "alert-email", "ses-sender", "alert-deliverable", "breakglass-alarm"]);
    expect(await bootstrapRefusal(staging, healthy())).toBeNull();
  });

  it("fails on a migrate task that has not run", async () => {
    const p = { ...healthy(), migrations: async () => ({ shipped: ["a", "b", "c"], finished: ["a"], unfinished: [] }) };
    expect(byId(await runPreflight(staging, p)).migrations).toMatchObject({ status: "fail", detail: expect.stringContaining("2 migration(s) not applied") });
    const half = { ...healthy(), migrations: async () => ({ shipped: ["a"], finished: [], unfinished: ["a"] }) };
    expect(byId(await runPreflight(staging, half)).migrations?.detail).toContain("started but not finished");
  });

  it("fails on a missing permission catalog or system role", async () => {
    const p = { ...healthy(), catalog: async () => ({ permissionKeys: PERMISSION_KEYS.slice(1), roleCodes: [] }) };
    expect(byId(await runPreflight(staging, p)).catalog).toMatchObject({ status: "fail" });
  });

  it("fails when encryption does not round-trip, and when the database role is too powerful", async () => {
    const p = { ...healthy(), encryptionRoundTrip: async () => false, databaseRoleProblems: async () => ['database role "x" is a superuser'] };
    const r = byId(await runPreflight(staging, p));
    expect(r.encryption?.status).toBe("fail");
    expect(r["db-role"]).toMatchObject({ status: "fail", detail: expect.stringContaining("superuser") });
  });

  it("fails outside development when the development seed has ever written to the database, and skips in development", async () => {
    const seeded = { ...healthy(), developmentSeedPresent: async () => true };
    for (const appEnv of ["staging", "production"]) {
      expect(byId(await runPreflight({ ...staging, appEnv }, seeded))["demo-data"]).toMatchObject({ status: "fail", detail: expect.stringContaining("demo payroll maker and checker") });
    }
    expect(byId(await runPreflight({ ...staging, appEnv: "development" }, seeded))["demo-data"]?.status).toBe("skip");
    expect(byId(await runPreflight(staging, healthy()))["demo-data"]?.status).toBe("pass");
    // The demo company has its own check, with the same rule.
    const withDemo = { ...healthy(), demoCompanyPresent: async () => true };
    expect(byId(await runPreflight(staging, withDemo))["demo-company"]).toMatchObject({ status: "fail", detail: expect.stringContaining("DEMO COMPANY") });
    expect(byId(await runPreflight({ ...staging, appEnv: "development" }, withDemo))["demo-company"]?.status).toBe("skip");
    expect(byId(await runPreflight(staging, healthy()))["demo-company"]?.status).toBe("pass");
  });

  it("a probe that throws is a failed check, not a crash", async () => {
    const p = { ...healthy(), topicSubscriptions: async () => { throw new Error("AccessDenied: sns:ListSubscriptionsByTopic"); } };
    expect(byId(await runPreflight(staging, p))["breakglass-alarm"]).toMatchObject({ status: "fail", detail: expect.stringContaining("AccessDenied") });
  });

  describe("the alerting checks, which also gate admin:bootstrap", () => {
    it("refuses when the alarm has no confirmed subscriber (all pending, or none)", async () => {
      for (const subs of [{ confirmed: 0, pending: 2 }, { confirmed: 0, pending: 0 }]) {
        const refusal = await bootstrapRefusal(staging, { ...healthy(), topicSubscriptions: async () => subs });
        expect(refusal).toContain("cannot tell anyone");
        expect(refusal).toContain("break-glass alarm");
      }
    });

    it("refuses when the alarm topic is not configured, or SECURITY_ALERT_EMAIL is missing", async () => {
      expect(await bootstrapRefusal({ ...staging, breakGlassTopicArn: undefined }, healthy())).toContain("BREAKGLASS_ALARM_TOPIC_ARN is not set");
      expect(await bootstrapRefusal({ ...staging, securityAlertEmail: undefined }, healthy())).toContain("SECURITY_ALERT_EMAIL");
    });

    it("refuses an unverified sender, disabled sending, and (in the SES sandbox) an alert address that is not a verified identity", async () => {
      expect(await bootstrapRefusal(staging, { ...healthy(), sesSender: async () => ({ verified: false, sendingEnabled: true, max24HourSend: 50_000 }) })).toContain("not a verified SES sender");
      expect(await bootstrapRefusal(staging, { ...healthy(), sesSender: async () => ({ verified: true, sendingEnabled: false, max24HourSend: 50_000 }) })).toContain("disabled");
      const sandbox = { ...healthy(), sesSender: async () => ({ verified: true, sendingEnabled: true, max24HourSend: 200 }) };
      expect(await bootstrapRefusal(staging, { ...sandbox, sesRecipientVerified: async () => false })).toContain("not a verified identity");
      expect(await bootstrapRefusal(staging, { ...sandbox, sesRecipientVerified: async () => true })).toBeNull(); // sandbox is a warning, not a bar, once the inbox is verified
      expect(byId(await runPreflight(staging, sandbox))["ses-sender"]?.status).toBe("warn");
    });

    it("does not check migrations or the catalog: bootstrap creates the first rows itself", async () => {
      const p = { ...healthy(), migrations: async () => { throw new Error("must not be called"); } };
      expect(await bootstrapRefusal(staging, p)).toBeNull();
    });

    it("is skipped in development, where mail is a file and there are no alarms", async () => {
      expect(await bootstrapRefusal({ appEnv: "development" }, healthy())).toBeNull();
      const r = byId(await runPreflight({ appEnv: "development" }, healthy()));
      expect(r["breakglass-alarm"]?.status).toBe("skip");
      expect(r["db-role"]?.status).toBe("skip");
    });
  });

  it("compareMigrations lists exactly the shipped migrations the database has not finished", () => {
    expect(compareMigrations(["a", "b", "c"], ["a", "c"], []).pending).toEqual(["b"]);
  });
});

describe("the real probes (no AWS here: only the local ones run)", () => {
  it("find every shipped migration applied in the test database, and the catalog present", async () => {
    const probes = awsProbes();
    const m = await probes.migrations();
    expect(m.shipped.length).toBeGreaterThan(0);
    expect(compareMigrations(m.shipped, m.finished, m.unfinished)).toEqual({ pending: [], unfinished: [] });
    const c = await probes.catalog();
    for (const k of PERMISSION_KEYS) expect(c.permissionKeys).toContain(k);
    expect(await probes.encryptionRoundTrip()).toBe(true);
    expect(await probes.developmentSeedPresent()).toBe(true); // this is a development-seeded database, which is exactly what the marker means
  });
});

describe("the AWS probes, against fake clients", () => {
  it("count confirmed and pending SNS subscriptions across pages", async () => {
    const pages = [
      { Subscriptions: [{ SubscriptionArn: "arn:aws:sns:x:1:t:aaa" }, { SubscriptionArn: "PendingConfirmation" }], NextToken: "p2" },
      { Subscriptions: [{ SubscriptionArn: "PendingConfirmation" }, { SubscriptionArn: "PendingConfirmation" }] },
    ];
    let call = 0;
    const sns = { send: async () => pages[call++]! };
    expect(await awsProbes({ sns: sns as never }).topicSubscriptions("arn:aws:sns:x:1:t")).toEqual({ confirmed: 1, pending: 3 });
  });

  it("reads SES verification of the address or its domain, the sending switch and the quota", async () => {
    const make = (status: Record<string, string>, enabled: boolean, quota: number) => ({
      send: async (cmd: { constructor: { name: string } }) =>
        cmd.constructor.name === "GetIdentityVerificationAttributesCommand"
          ? { VerificationAttributes: Object.fromEntries(Object.entries(status).map(([k, v]) => [k, { VerificationStatus: v }])) }
          : cmd.constructor.name === "GetAccountSendingEnabledCommand"
            ? { Enabled: enabled }
            : { Max24HourSend: quota },
    });
    const domainOnly = awsProbes({ ses: make({ "example.org": "Success", "no-reply@example.org": "Pending" }, true, 50000) as never });
    expect(await domainOnly.sesSender("no-reply@example.org")).toEqual({ verified: true, sendingEnabled: true, max24HourSend: 50000 });
    const unverified = awsProbes({ ses: make({ "example.org": "Pending" }, false, 200) as never });
    expect(await unverified.sesSender("no-reply@example.org")).toEqual({ verified: false, sendingEnabled: false, max24HourSend: 200 });
    expect(await unverified.sesRecipientVerified("owners@example.org")).toBe(false);
  });
});
