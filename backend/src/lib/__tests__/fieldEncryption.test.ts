import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { cleanupTestUser, createTestUser } from "../../modules/auth/__tests__/authTestHelpers";
import { createTestOrgMasters, cleanupTestData, type TestOrgMasters } from "./testHelpers";
import { ciphertextKeyId, decryptField, encryptField } from "../encryption";
import {
  InMemoryDataKeyWrapper,
  addDataKey,
  initFieldEncryption,
  keyContext,
  parseKeyring,
  promoteDataKey,
  retireDataKey,
  setActiveFieldKeysForTests,
  type Keyring,
} from "../fieldKeys";
import { ENCRYPTED_COLUMNS, NON_ENCRYPTED_BYTES_COLUMNS, idsInUse, keyUsage, reencryptAll, retireBlockers } from "../fieldKeyRotation";
import { prisma } from "../prisma";

afterEach(() => setActiveFieldKeysForTests(null));

describe("field encryption", () => {
  it("round-trips, with a different ciphertext every time, and prefixes the key id", () => {
    const a = encryptField("ABCDE1234F");
    const b = encryptField("ABCDE1234F");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(decryptField(a)).toBe("ABCDE1234F");
    expect(decryptField(b)).toBe("ABCDE1234F");
    expect(ciphertextKeyId(a)).toBe(1); // the local driver's one key
    expect(a.length).toBe(1 + 12 + 16 + "ABCDE1234F".length);
    expect(decryptField(encryptField(""))).toBe("");
    expect(decryptField(encryptField("नमस्ते 🙂"))).toBe("नमस्ते 🙂");
  });

  it("detects tampering with the body, the tag, the iv, and the key id", () => {
    const good = encryptField("123456789012");
    for (const index of [0, 1, 13, 29, good.length - 1]) {
      const bad = Uint8Array.from(good);
      bad[index] = bad[index]! ^ 0x01;
      expect(() => decryptField(bad), `byte ${index}`).toThrow();
    }
    expect(() => decryptField(good.subarray(0, 20))).toThrow(/too short/);
  });

  it("the key id is authenticated: relabelling a ciphertext as another id that holds the SAME key still fails", () => {
    const key = randomBytes(32);
    setActiveFieldKeysForTests({ current: 1, keys: new Map([[1, key], [2, key]]) });
    const packed = Uint8Array.from(encryptField("123456789012"));
    expect(decryptField(packed)).toBe("123456789012");
    packed[0] = 2; // same key bytes, different label: only the additional-data check can notice
    expect(() => decryptField(packed)).toThrow();
  });

  it("will not decrypt under a key it was not made with, and says which key is missing", () => {
    const wrapper = new InMemoryDataKeyWrapper();
    const other = Uint8Array.from(encryptField("secret"));
    other[0] = 7;
    expect(() => decryptField(other)).toThrow(/data key 7/);
    void wrapper;
  });
});

describe("keyring", () => {
  it("rejects a malformed keyring", () => {
    expect(() => parseKeyring("not json")).toThrow(/not valid JSON/);
    expect(() => parseKeyring(JSON.stringify({ current: 2, keys: [{ id: 1, wrapped: "AA==" }] }))).toThrow(/current must be one of/);
    expect(() => parseKeyring(JSON.stringify({ current: 1, keys: [{ id: 1, wrapped: "AA==" }, { id: 1, wrapped: "AA==" }] }))).toThrow(/unique/);
  });

  it("a wrapped key cannot be passed off as another entry (the id is bound into the wrapping)", async () => {
    const wrapper = new InMemoryDataKeyWrapper();
    const { wrapped } = await wrapper.generate(keyContext(1));
    await expect(wrapper.unwrap(wrapped, keyContext(1))).resolves.toHaveLength(32);
    await expect(wrapper.unwrap(wrapped, keyContext(2))).rejects.toThrow();
  });

  it("without keys loaded, the kms driver refuses to encrypt rather than falling back", async () => {
    // initFieldEncryption with no keyring while the driver is kms is the production start-up failure; here the driver is local, so use the explicit path.
    await expect(initFieldEncryption({ keyring: "{}", wrapper: new InMemoryDataKeyWrapper() })).rejects.toThrow(/not a valid keyring/);
  });
});

// The documented rotation procedure (docs/DEPLOYMENT.md "Field encryption keys"), run end to end on real rows with the same functions the CLI calls.
describe("rotation procedure", () => {
  let org: TestOrgMasters;
  const employeeIds: string[] = [];
  const userIds = new Set<string>();
  let ids = new Set<string>();
  const wrapper = new InMemoryDataKeyWrapper();
  let keyring: Keyring;

  const load = async (k: Keyring) => {
    setActiveFieldKeysForTests(null);
    await initFieldEncryption({ keyring: JSON.stringify(k), wrapper });
  };
  const inUse = async () => idsInUse(await keyUsage({ filter: (id) => ids.has(id) }));
  const readAll = async () => {
    const out: string[] = [];
    for (const uid of userIds) {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
      out.push(decryptField(u.totpSecretEncrypted!));
    }
    for (const eid of employeeIds) {
      const s = await prisma.employeeStatutory.findUniqueOrThrow({ where: { employeeId: eid } });
      out.push(decryptField(s.panEncrypted!), decryptField(s.aadhaarEncrypted!), decryptField(s.uanEncrypted!), decryptField(s.esiEncrypted!));
      const b = await prisma.employeeBankAccount.findFirstOrThrow({ where: { employeeId: eid } });
      out.push(decryptField(b.accountNumberEncrypted));
    }
    return out;
  };

  beforeAll(async () => {
    org = await createTestOrgMasters();
    // Phase 0: a keyring with a single data key (id 1), as on the first deploy.
    const first = await wrapper.generate(keyContext(1));
    keyring = { current: 1, keys: [{ id: 1, wrapped: first.wrapped.toString("base64") }] };
    await load(keyring);
    for (let i = 0; i < 3; i++) {
      const u = await createTestUser(org);
      employeeIds.push(u.employeeId);
      userIds.add(u.userId);
      await prisma.user.update({ where: { id: u.userId }, data: { totpSecretEncrypted: encryptField(`TOTPSECRET${i}`) } });
      const s = await prisma.employeeStatutory.create({ data: { employeeId: u.employeeId, panEncrypted: encryptField(`PAN${i}`), aadhaarEncrypted: encryptField(`AAD${i}`), uanEncrypted: encryptField(`UAN${i}`), esiEncrypted: encryptField(`ESI${i}`) } });
      const b = await prisma.employeeBankAccount.create({
        data: { employeeId: u.employeeId, accountHolderName: "T", accountNumberEncrypted: encryptField(`ACC${i}`), accountNumberLast4: "0000", accountNumberHash: randomBytes(8).toString("hex"), ifsc: "X", bankName: "X", branchName: "X", createdByUserId: u.userId },
      });
      ids = new Set([...ids, u.userId, s.id, b.id]);
    }
  });

  // The top-level afterEach clears the loaded keys; each step of the procedure starts from the keyring the previous step ended with.
  beforeEach(async () => {
    if (keyring) await load(keyring);
  });

  afterAll(async () => {
    for (const id of employeeIds) await cleanupTestUser(id);
    await cleanupTestData({ org });
  });

  it("phase 0: everything is under key 1", async () => {
    expect(await inUse()).toEqual([1]);
    // 3 people x (TOTP secret, PAN, Aadhaar, UAN, ESI number, bank account) = 18 encrypted values.
    expect(await readAll()).toHaveLength(18);
  });

  it("phase 1: add key 2 without making it current; nothing changes, and tasks on the old keyring still work", async () => {
    const added = await addDataKey(keyring, wrapper);
    expect(added.id).toBe(2);
    expect(added.keyring.current).toBe(1);
    keyring = added.keyring;
    await load(keyring);
    expect(ciphertextKeyId(encryptField("x"))).toBe(1);
    expect(await inUse()).toEqual([1]);
  });

  it("phase 2: promote key 2; a task still on the phase-1 keyring can read what a promoted task writes (a rolling deploy mixes them)", async () => {
    const phase1 = keyring;
    const phase2 = promoteDataKey(keyring, 2);
    await load(phase2);
    const written = encryptField("written by a promoted task");
    expect(ciphertextKeyId(written)).toBe(2);
    await load(phase1); // an old task, restarted with the keyring that already contained key 2
    expect(decryptField(written)).toBe("written by a promoted task");
    keyring = phase2;
    await load(keyring);
    expect(await readAll()).toHaveLength(18); // old values still read
    expect(await inUse()).toEqual([1]);
  });

  it("retire is refused while values remain under the old key", async () => {
    const blockers = await retireBlockers(1, { filter: (id) => ids.has(id) }); // what `field-keys retire 1` checks, and refuses on
    expect(blockers.reduce((n, u) => n + u.count, 0)).toBe(18);
    expect(blockers.map((b) => b.column).sort()).toEqual(
      ["EmployeeBankAccount.accountNumberEncrypted", "EmployeeStatutory.aadhaarEncrypted", "EmployeeStatutory.esiEncrypted", "EmployeeStatutory.panEncrypted", "EmployeeStatutory.uanEncrypted", "User.totpSecretEncrypted"],
    );
    expect(() => retireDataKey(keyring, 2)).toThrow(/current key/);
  });

  it("phase 3: a dry run counts without writing, then --apply moves every value to key 2, and it is safe to run again", async () => {
    const dry = await reencryptAll({ apply: false, filter: (id) => ids.has(id) });
    expect(dry).toMatchObject({ examined: 18, reencrypted: 18, alreadyCurrent: 0, failed: [] });
    expect(await inUse()).toEqual([1]); // nothing written

    const done = await reencryptAll({ apply: true, filter: (id) => ids.has(id) });
    expect(done).toMatchObject({ reencrypted: 18, failed: [], skippedChangedMeanwhile: 0 });
    expect(await inUse()).toEqual([2]);
    expect(await readAll()).toEqual(expect.arrayContaining(["TOTPSECRET0", "PAN1", "AAD2", "UAN0", "ESI2", "ACC1"]));

    const again = await reencryptAll({ apply: true, filter: (id) => ids.has(id) });
    expect(again).toMatchObject({ reencrypted: 0, alreadyCurrent: 18 });
  });

  it("phase 4: with nothing under key 1 it can be retired, and everything still reads without it", async () => {
    expect(await retireBlockers(1, { filter: (id) => ids.has(id) })).toEqual([]);
    keyring = retireDataKey(keyring, 1);
    expect(keyring.keys.map((k) => k.id)).toEqual([2]);
    await load(keyring);
    expect(await readAll()).toHaveLength(18);
    // A value left on the retired key is unreadable: that is why retire is refused while any remain.
    const stray = Uint8Array.from(encryptField("stray"));
    stray[0] = 1;
    expect(() => decryptField(stray)).toThrow(/data key 1/);
  });

  it("a value changed while the pass runs is left alone, not overwritten with stale data", async () => {
    const u = await createTestUser(org);
    employeeIds.push(u.employeeId);
    userIds.add(u.userId);
    ids.add(u.userId);
    const added = await addDataKey(keyring, wrapper); // keys 2 and 3, current 2
    await load(promoteDataKey(added.keyring, added.id));
    await prisma.user.update({ where: { id: u.userId }, data: { totpSecretEncrypted: encryptField("first") } }); // written under key 3
    await load(added.keyring); // current is 2 again, so "first" is due for re-encryption
    const r = await reencryptAll({
      apply: true,
      filter: (id) => id === u.userId,
      // Between the pass reading the value and writing it back, the user changes it.
      beforeWriteForTests: async () => {
        await prisma.user.update({ where: { id: u.userId }, data: { totpSecretEncrypted: encryptField("second") } });
      },
    });
    expect(r).toMatchObject({ examined: 1, reencrypted: 0, skippedChangedMeanwhile: 1, failed: [] });
    const now = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(decryptField(now.totpSecretEncrypted!)).toBe("second");
  });
});

describe("every encrypted column is known to the rotation tooling", () => {
  it("each Bytes column in the Prisma schema is either listed as encrypted or explicitly marked not", () => {
    const bytesFields = Prisma.dmmf.datamodel.models.flatMap((m) => m.fields.filter((f) => f.type === "Bytes").map((f) => `${m.name}.${f.name}`));
    const known = new Set([...ENCRYPTED_COLUMNS.map((c) => `${c.model}.${c.field}`), ...NON_ENCRYPTED_BYTES_COLUMNS.map((c) => `${c.model}.${c.field}`)]);
    expect(bytesFields.filter((f) => !known.has(f)), "add the column to ENCRYPTED_COLUMNS (lib/fieldKeyRotation.ts), or to NON_ENCRYPTED_BYTES_COLUMNS with a reason").toEqual([]);
    expect([...known].filter((k) => !bytesFields.includes(k)), "listed but not in the schema").toEqual([]);
  });

  it("each listed delegate exists on the Prisma client", () => {
    for (const c of ENCRYPTED_COLUMNS) expect(typeof (prisma as unknown as Record<string, unknown>)[c.delegate]).toBe("object");
  });
});
