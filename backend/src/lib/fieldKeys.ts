import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { z } from "zod";
import { env } from "../config/env";

// The key hierarchy behind field encryption (lib/encryption.ts), Phase 1.5 D7.
//
//   KMS customer-managed key (never leaves KMS)
//     └─ wraps one or more DATA KEYS (AES-256), each with a small id (1..255)
//          └─ encrypt the fields; every ciphertext starts with the id of the data key that made it
//
// The wrapped data keys are the FIELD_KEYRING setting (JSON, safe to store: useless without kms:Decrypt on the CMK).
// Each task unwraps them once at start (initFieldEncryption) and keeps the plaintext in memory only, so encryptField and
// decryptField stay synchronous. Rotation adds a data key (and, if a CMK leaked, wraps it under a new CMK), makes it current, re-encrypts, and
// retires the old one: see docs/DEPLOYMENT.md "Field encryption keys" and scripts/field-keys.ts.
//
// Local development (FIELD_ENCRYPTION_DRIVER=local) has one static key, id 1, derived from KMS_FIELD_KEY_ID. env.ts refuses that driver
// in staging and production.

const KeyringSchema = z
  .object({
    current: z.number().int().min(1).max(255),
    keys: z
      .array(z.object({ id: z.number().int().min(1).max(255), wrapped: z.string().min(1), createdAt: z.string().optional(), cmk: z.string().optional() }))
      .min(1),
  })
  .refine((k) => new Set(k.keys.map((e) => e.id)).size === k.keys.length, { message: "key ids must be unique" })
  .refine((k) => k.keys.some((e) => e.id === k.current), { message: "current must be one of the key ids" });

export type Keyring = z.infer<typeof KeyringSchema>;

export function parseKeyring(raw: string): Keyring {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("FIELD_KEYRING is not valid JSON.");
  }
  const parsed = KeyringSchema.safeParse(json);
  if (!parsed.success) throw new Error(`FIELD_KEYRING is not a valid keyring: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return parsed.data;
}

/** Wraps and unwraps data keys. KMS in AWS; an in-memory stand-in in tests. */
export interface DataKeyWrapper {
  /** A fresh 32-byte data key, plaintext and wrapped. `context` is bound into the wrapping so a blob cannot be passed off as another entry. */
  generate(context: Record<string, string>, cmk?: string): Promise<{ plaintext: Buffer; wrapped: Buffer }>;
  unwrap(wrapped: Buffer, context: Record<string, string>): Promise<Buffer>;
}

export const keyContext = (id: number): Record<string, string> => ({ purpose: "wellsure-field-data-key", keyId: String(id) });

export class KmsDataKeyWrapper implements DataKeyWrapper {
  private readonly client: KMSClient;
  constructor(
    private readonly defaultCmk: string,
    region: string = env.AWS_REGION,
  ) {
    this.client = new KMSClient({ region });
  }

  async generate(context: Record<string, string>, cmk?: string) {
    const r = await this.client.send(new GenerateDataKeyCommand({ KeyId: cmk ?? this.defaultCmk, KeySpec: "AES_256", EncryptionContext: context }));
    if (!r.Plaintext || !r.CiphertextBlob) throw new Error("KMS returned no data key.");
    return { plaintext: Buffer.from(r.Plaintext), wrapped: Buffer.from(r.CiphertextBlob) };
  }

  async unwrap(wrapped: Buffer, context: Record<string, string>) {
    // No KeyId on purpose: the blob names the CMK that wrapped it, so entries wrapped under an older CMK still open after a CMK change.
    const r = await this.client.send(new DecryptCommand({ CiphertextBlob: wrapped, EncryptionContext: context }));
    if (!r.Plaintext) throw new Error("KMS returned no plaintext.");
    return Buffer.from(r.Plaintext);
  }
}

/** The live keys: id -> plaintext data key, and which one new ciphertexts use. */
export type ActiveKeys = { current: number; keys: Map<number, Buffer> };

let active: ActiveKeys | null = null;

const localKey = (): Buffer => createHash("sha256").update(env.KMS_FIELD_KEY_ID).digest();

export function activeFieldKeys(): ActiveKeys {
  if (active) return active;
  if (env.FIELD_ENCRYPTION_DRIVER === "local") {
    active = { current: 1, keys: new Map([[1, localKey()]]) };
    return active;
  }
  throw new Error("Field encryption keys are not loaded: initFieldEncryption() must run at startup before any field is encrypted or decrypted.");
}

/** Unwraps the keyring once. Called at startup by every mode that touches encrypted fields; the local driver needs nothing. */
export async function initFieldEncryption(opts: { keyring?: string; wrapper?: DataKeyWrapper } = {}): Promise<void> {
  if (env.FIELD_ENCRYPTION_DRIVER === "local" && !opts.keyring) {
    activeFieldKeys();
    return;
  }
  const raw = opts.keyring ?? env.FIELD_KEYRING;
  if (!raw) throw new Error("FIELD_KEYRING is required when FIELD_ENCRYPTION_DRIVER=kms (docs/DEPLOYMENT.md, 'Field encryption keys').");
  const keyring = parseKeyring(raw);
  const wrapper = opts.wrapper ?? new KmsDataKeyWrapper(env.KMS_FIELD_KEY_ID);
  const keys = new Map<number, Buffer>();
  for (const entry of keyring.keys) {
    const key = await wrapper.unwrap(Buffer.from(entry.wrapped, "base64"), keyContext(entry.id));
    if (key.length !== 32) throw new Error(`Data key ${entry.id} is not 256 bits.`);
    keys.set(entry.id, key);
  }
  active = { current: keyring.current, keys };
}

/** Test-only: replace or clear the loaded keys. */
export function setActiveFieldKeysForTests(next: ActiveKeys | null): void {
  if (!process.env.VITEST) throw new Error("setActiveFieldKeysForTests is for tests only.");
  active = next;
}

// ── Rotation: pure keyring edits; the operator puts the result in the secret. ──

/** Adds a data key to the keyring WITHOUT making it current (phase 1: every task learns the key before any task writes with it). */
export async function addDataKey(keyring: Keyring, wrapper: DataKeyWrapper, opts: { cmk?: string; now?: Date } = {}): Promise<{ keyring: Keyring; id: number }> {
  const used = new Set(keyring.keys.map((k) => k.id));
  let id = 1;
  while (used.has(id)) id += 1;
  if (id > 255) throw new Error("No free key id: retire old data keys first.");
  const { wrapped } = await wrapper.generate(keyContext(id), opts.cmk);
  const entry = { id, wrapped: wrapped.toString("base64"), createdAt: (opts.now ?? new Date()).toISOString(), ...(opts.cmk ? { cmk: opts.cmk } : {}) };
  return { keyring: { ...keyring, keys: [...keyring.keys, entry] }, id };
}

/** Makes an existing key current (phase 2). */
export function promoteDataKey(keyring: Keyring, id: number): Keyring {
  if (!keyring.keys.some((k) => k.id === id)) throw new Error(`There is no data key ${id} in the keyring.`);
  return { ...keyring, current: id };
}

/** Removes a key (phase 4). The caller has already checked nothing is encrypted under it. */
export function retireDataKey(keyring: Keyring, id: number): Keyring {
  if (keyring.current === id) throw new Error(`Data key ${id} is the current key; promote another one first.`);
  if (!keyring.keys.some((k) => k.id === id)) throw new Error(`There is no data key ${id} in the keyring.`);
  return { ...keyring, keys: keyring.keys.filter((k) => k.id !== id) };
}

/** A wrapper that needs no AWS: AES-GCM under a master key held in the process. Tests, and nothing else. */
export class InMemoryDataKeyWrapper implements DataKeyWrapper {
  constructor(private readonly master: Buffer = randomBytes(32)) {
    if (!process.env.VITEST) throw new Error("InMemoryDataKeyWrapper is for tests only.");
  }
  private aad = (ctx: Record<string, string>): Buffer => Buffer.from(JSON.stringify(Object.entries(ctx).sort()));
  async generate(context: Record<string, string>) {
    const plaintext = randomBytes(32);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.master, iv);
    c.setAAD(this.aad(context));
    const ct = Buffer.concat([c.update(plaintext), c.final()]);
    return { plaintext, wrapped: Buffer.concat([iv, c.getAuthTag(), ct]) };
  }
  async unwrap(wrapped: Buffer, context: Record<string, string>) {
    const d = createDecipheriv("aes-256-gcm", this.master, wrapped.subarray(0, 12));
    d.setAAD(this.aad(context));
    d.setAuthTag(wrapped.subarray(12, 28));
    return Buffer.concat([d.update(wrapped.subarray(28)), d.final()]);
  }
}
