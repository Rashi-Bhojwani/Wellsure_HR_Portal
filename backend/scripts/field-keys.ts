import { env } from "../src/config/env";
import { initFieldEncryption, addDataKey, parseKeyring, promoteDataKey, retireDataKey, KmsDataKeyWrapper, type Keyring } from "../src/lib/fieldKeys";
import { JSON_HELD_COLUMNS, idsInUse, keyUsage, reencryptAll, retireBlockers } from "../src/lib/fieldKeyRotation";
import { prisma } from "../src/lib/prisma";
import { parseArgs } from "./lib/cli";

// `npm run field-keys -- <command>` — the rotation tooling for the field-encryption data keys.
// The procedure, in order, with what to check between steps, is docs/DEPLOYMENT.md "Field encryption keys".
//
//   status                      the keyring (ids, which is current, when added) and how many stored values each key made
//   add [--cmk <arn>]           PHASE 1: add a data key (wrapped by KMS; --cmk wraps it under a different KMS key, for a leaked CMK).
//                               Prints the new keyring. It is NOT current yet, so deploying it changes nothing until phase 2.
//   promote <id>                PHASE 2: make a key current. Run only after every task has restarted with the phase 1 keyring.
//   reencrypt [--apply]         PHASE 3: re-encrypt every stored value under the current key. Without --apply it only counts.
//   retire <id>                 PHASE 4: remove a key from the keyring. Refused while any value is still encrypted under it.
//
// The keyring commands print the new keyring JSON on stdout (everything else goes to stderr) and change nothing themselves: a person
// puts it in the secret and deploys. None of this ever prints a key.

const say = (m: string): void => console.error(m);

function currentKeyring(): Keyring {
  if (env.FIELD_ENCRYPTION_DRIVER !== "kms" || !env.FIELD_KEYRING) throw new Error("This environment has no keyring (FIELD_ENCRYPTION_DRIVER is not kms). Rotation applies to staging and production.");
  return parseKeyring(env.FIELD_KEYRING);
}

const printKeyring = (k: Keyring): void => {
  console.log(JSON.stringify(k));
};

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const positional = rest.filter((a) => !a.startsWith("--"));

  if (command === "add") {
    const cmk = typeof args.cmk === "string" ? args.cmk : undefined;
    const { keyring, id } = await addDataKey(currentKeyring(), new KmsDataKeyWrapper(env.KMS_FIELD_KEY_ID), cmk ? { cmk } : {});
    say(`Added data key ${id}${cmk ? ` (wrapped by ${cmk})` : ""}. It is not current. Put the keyring below in FIELD_KEYRING, deploy, and wait until every task has restarted; then run promote ${id}.`);
    printKeyring(keyring);
  } else if (command === "promote") {
    const id = Number(positional[0]);
    const keyring = promoteDataKey(currentKeyring(), id);
    say(`Data key ${id} is current in the keyring below. Deploy it, then run reencrypt.`);
    printKeyring(keyring);
  } else if (command === "status") {
    await initFieldEncryption();
    const keyring = env.FIELD_ENCRYPTION_DRIVER === "kms" ? currentKeyring() : null;
    say(keyring ? `Keyring: current key ${keyring.current}; keys ${keyring.keys.map((k) => `${k.id}${k.createdAt ? ` (added ${k.createdAt.slice(0, 10)})` : ""}`).join(", ")}` : "Local driver: one static development key, id 1.");
    const usage = await keyUsage();
    for (const u of usage) say(`  ${u.column}: ${u.count} value(s) under key ${u.keyId}`);
    if (usage.length === 0) say("  no encrypted values stored");
    const inKeyring = new Set(keyring ? keyring.keys.map((k) => k.id) : [1]);
    const orphan = idsInUse(usage).filter((id) => !inKeyring.has(id));
    if (orphan.length > 0) say(`  WARNING: values exist under key(s) ${orphan.join(", ")}, which are not in the keyring and cannot be read.`);
  } else if (command === "reencrypt") {
    await initFieldEncryption();
    const apply = args.apply === true;
    const r = await reencryptAll({ apply });
    say(`${apply ? "Re-encrypted" : "Would re-encrypt"} ${r.reencrypted} value(s); ${r.alreadyCurrent} already under the current key; ${r.skippedChangedMeanwhile} changed while running (run again); ${r.failed.length} failed.`);
    for (const f of r.failed) say(`  FAILED ${f.column} ${f.id}: ${f.error}`);
    if (!apply) say("Nothing was written. Run again with --apply.");
    if (r.failed.length > 0) process.exitCode = 1;
  } else if (command === "retire") {
    await initFieldEncryption();
    const id = Number(positional[0]);
    const still = await retireBlockers(id);
    if (still.length > 0) throw new Error(`Refusing: ${still.reduce((n, u) => n + u.count, 0)} stored value(s) are still encrypted under key ${id} (${still.map((u) => u.column).join(", ")}). Run reencrypt --apply first.${still.some((u) => (Object.values(JSON_HELD_COLUMNS) as string[]).includes(u.column)) ? " Values held inside a record (a sealed payroll value, a pending request, an upload) are not rewritten by reencrypt: decide or discard the request or upload, or enter the sealed value again as a new version (docs/DEPLOYMENT.md)." : ""}`);
    const keyring = retireDataKey(currentKeyring(), id);
    say(`Nothing is encrypted under key ${id}. The keyring below no longer has it.`);
    say("Backups taken before the rotation still hold values under that key: see docs/DEPLOYMENT.md before destroying the old KMS key.");
    printKeyring(keyring);
  } else {
    say("Usage: npm run field-keys -- status | add [--cmk <arn>] | promote <id> | reencrypt [--apply] | retire <id>");
    process.exitCode = 2;
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
