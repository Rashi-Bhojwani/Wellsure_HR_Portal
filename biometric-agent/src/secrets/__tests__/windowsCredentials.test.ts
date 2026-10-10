import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importSecretInbox, INBOX_DIR, inboxWaiting } from "../inbox";
import { memoryLogger } from "../../log";
import { AGENT_KEY_TARGET, COMM_KEY_CACHE_MS, commKeyTarget, READ_SCRIPT, WindowsCredentialStore, WRITE_SCRIPT, type PowerShellRunner } from "../windowsCredentials";

// The Credential Manager logic against a fake PowerShell. The Windows calls
// themselves (CredRead/CredWrite) are exercised by the CI Windows job.
function fakeVault() {
  const vault = new Map<string, string>();
  const calls: Array<{ script: string; env: Record<string, string> }> = [];
  const run: PowerShellRunner = async (script, env) => {
    calls.push({ script, env });
    const target = env.WELLSURE_CRED_TARGET!;
    if (script === WRITE_SCRIPT) {
      vault.set(target, env.WELLSURE_CRED_VALUE!);
      return { code: 0, stdout: "", stderr: "" };
    }
    return vault.has(target) ? { code: 0, stdout: vault.get(target)!, stderr: "" } : { code: 2, stdout: "", stderr: "" };
  };
  return { vault, calls, run };
}

describe("Windows Credential Manager store", () => {
  it("stores and reads the agent key and comm keys under fixed targets", async () => {
    const v = fakeVault();
    const store = new WindowsCredentialStore(v.run);
    expect(await store.agentKey()).toBeNull(); // not stored yet
    await store.setAgentKey("wsa_secret");
    await store.setCommKey("AEXY225060969", "123456");
    expect(v.vault.get(AGENT_KEY_TARGET)).toBe("wsa_secret");
    expect(v.vault.get(commKeyTarget("AEXY225060969"))).toBe("123456");
    expect(AGENT_KEY_TARGET).toBe("WellsureAgent/agent-key");
    expect(await store.agentKey()).toBe("wsa_secret");
    expect(await store.commKey("AEXY225060969")).toBe(123456);
    expect(await store.commKey("NO-SUCH-DEVICE")).toBeNull();
  });

  it("the secret and the target travel in the child's environment, never in the script or on a command line", async () => {
    const v = fakeVault();
    const store = new WindowsCredentialStore(v.run);
    await store.setAgentKey("wsa_do_not_leak");
    await store.agentKey();
    for (const c of v.calls) {
      expect(c.script).not.toContain("wsa_do_not_leak");
      expect(c.script).not.toContain("WellsureAgent/agent-key"); // the target is read from the environment too
    }
    expect(READ_SCRIPT).toContain("$env:WELLSURE_CRED_TARGET");
    expect(WRITE_SCRIPT).toContain("$env:WELLSURE_CRED_VALUE");
  });

  it("the agent key is read again every time (a rotated key works without a restart); comm keys are cached for minutes", async () => {
    const v = fakeVault();
    let now = 1_000_000;
    const store = new WindowsCredentialStore(v.run, () => now);
    await store.setAgentKey("old");
    await store.setCommKey("DEV-1", "111");
    v.calls.length = 0;
    expect(await store.agentKey()).toBe("old");
    v.vault.set(AGENT_KEY_TARGET, "new");
    expect(await store.agentKey()).toBe("new");
    expect(v.calls).toHaveLength(2);

    v.calls.length = 0;
    expect(await store.commKey("DEV-1")).toBe(111);
    expect(await store.commKey("DEV-1")).toBe(111);
    expect(await store.commKey("DEV-1")).toBe(111);
    expect(v.calls).toHaveLength(1); // one PowerShell start, not one per 30 s cycle
    v.vault.set(commKeyTarget("DEV-1"), "222");
    now += COMM_KEY_CACHE_MS + 1;
    expect(await store.commKey("DEV-1")).toBe(222); // picked up after the cache expires
  });

  it("a real failure is an error that says what failed, not a silent 'no key'", async () => {
    const store = new WindowsCredentialStore(async () => ({ code: 1, stdout: "", stderr: "CredRead failed: Win32 error 1312" }));
    await expect(store.agentKey()).rejects.toThrow(/Could not read "WellsureAgent\/agent-key".*1312/);
    await expect(new WindowsCredentialStore(async () => ({ code: 1, stdout: "", stderr: "" })).setAgentKey("x")).rejects.toThrow(/Could not store/);
  });

  it("refuses a comm key that isn't a whole number", async () => {
    const store = new WindowsCredentialStore(fakeVault().run);
    await expect(store.setCommKey("DEV-1", "12ab")).rejects.toThrow(/whole number/);
    const bad = fakeVault();
    bad.vault.set(commKeyTarget("DEV-2"), "not-a-number");
    await expect(new WindowsCredentialStore(bad.run).commKey("DEV-2")).rejects.toThrow(/whole number/);
  });
});

describe("the secrets inbox (how install.ps1 and set-key.ps1 hand secrets to the service account)", () => {
  const setup = () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "wsa-inbox-"));
    const inbox = path.join(dataDir, INBOX_DIR);
    mkdirSync(inbox, { recursive: true });
    const drop = (name: string, value: string) => writeFileSync(path.join(inbox, name), value);
    return { dataDir, inbox, drop };
  };

  it("stores each dropped value in Credential Manager and deletes the file", async () => {
    const v = fakeVault();
    const store = new WindowsCredentialStore(v.run);
    const { dataDir, inbox, drop } = setup();
    drop("agent-key.txt", "wsa_abc123\r\n");
    drop("commkey-AEXY225060969.txt", "424242");
    expect(inboxWaiting(dataDir)).toBe(2);
    const res = await importSecretInbox(dataDir, store, memoryLogger());
    expect(res.imported.sort()).toEqual(["agent-key.txt", "commkey-AEXY225060969.txt"]);
    expect(res.failed).toEqual([]);
    expect(v.vault.get(AGENT_KEY_TARGET)).toBe("wsa_abc123");
    expect(v.vault.get(commKeyTarget("AEXY225060969"))).toBe("424242");
    expect(readdirSync(inbox)).toEqual([]); // consumed: nothing left lying around
  });

  it("never logs a value", async () => {
    const logger = memoryLogger();
    const { dataDir, drop } = setup();
    drop("agent-key.txt", "wsa_super_secret");
    await importSecretInbox(dataDir, new WindowsCredentialStore(fakeVault().run), logger);
    expect(JSON.stringify(logger.lines)).not.toContain("wsa_super_secret");
  });

  it("a value that can't be stored stays in the inbox for the next start, and is reported", async () => {
    const logger = memoryLogger();
    const store = new WindowsCredentialStore(async () => ({ code: 1, stdout: "", stderr: "CredWrite failed: Win32 error 1312" }));
    const { dataDir, inbox, drop } = setup();
    drop("agent-key.txt", "wsa_abc");
    const res = await importSecretInbox(dataDir, store, logger);
    expect(res.imported).toEqual([]);
    expect(res.failed[0]).toMatchObject({ file: "agent-key.txt", error: expect.stringMatching(/1312/) });
    expect(readdirSync(inbox)).toEqual(["agent-key.txt"]);
    expect(logger.lines.some((l) => l.level === "error")).toBe(true);
    expect(JSON.stringify(logger.lines)).not.toContain("wsa_abc");
  });

  it("an empty file is discarded, an unexpected file is ignored (and not deleted), and no inbox is fine", async () => {
    const store = new WindowsCredentialStore(fakeVault().run);
    const { dataDir, inbox, drop } = setup();
    drop("agent-key.txt", "  \n");
    drop("notes.txt", "something else");
    drop("commkey-..%2F..%2Fx.txt", "1"); // not a legal serial
    const res = await importSecretInbox(dataDir, store, memoryLogger());
    expect(res.imported).toEqual([]);
    expect(readdirSync(inbox).sort()).toEqual(["commkey-..%2F..%2Fx.txt", "notes.txt"]);
    expect(existsSync(path.join(inbox, "agent-key.txt"))).toBe(false);
    expect(await importSecretInbox(path.join(dataDir, "nowhere"), store, memoryLogger())).toEqual({ imported: [], failed: [] });
  });
});
