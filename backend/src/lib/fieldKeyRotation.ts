import { ciphertextKeyId, decryptField, encryptField } from "./encryption";
import { activeFieldKeys } from "./fieldKeys";
import { prisma } from "./prisma";

// Every column that holds output of encryptField, and the passes that need to know about all of them:
// "which data keys are still in use" (before a key is retired) and "re-encrypt everything under the current key".
// A test (lib/__tests__/fieldKeyRotation.test.ts) fails if the Prisma schema gains a Bytes column that is in neither list,
// so a new encrypted column cannot be forgotten here.

export type EncryptedColumn = { model: string; delegate: string; field: string };

export const ENCRYPTED_COLUMNS: ReadonlyArray<EncryptedColumn> = [
  { model: "User", delegate: "user", field: "totpSecretEncrypted" },
  { model: "EmployeeStatutory", delegate: "employeeStatutory", field: "panEncrypted" },
  { model: "EmployeeStatutory", delegate: "employeeStatutory", field: "aadhaarEncrypted" },
  { model: "EmployeeStatutory", delegate: "employeeStatutory", field: "uanEncrypted" },
  { model: "EmployeeBankAccount", delegate: "employeeBankAccount", field: "accountNumberEncrypted" },
];

/** Bytes columns that are deliberately NOT field-encrypted (none today). Naming one here is the decision that it holds no personal data. */
export const NON_ENCRYPTED_BYTES_COLUMNS: ReadonlyArray<{ model: string; field: string; why: string }> = [];

type Row = { id: string } & Record<string, unknown>;
// The Prisma client's delegates share this shape for the calls below; typed loosely because the delegate is chosen by name.
type Delegate = {
  findMany(args: unknown): Promise<Row[]>;
  updateMany(args: unknown): Promise<{ count: number }>;
};
const delegateOf = (c: EncryptedColumn): Delegate => (prisma as unknown as Record<string, Delegate>)[c.delegate]!;

const PAGE = 500;

async function* eachValue(column: EncryptedColumn): AsyncGenerator<{ id: string; value: Uint8Array }> {
  let after: string | undefined;
  for (;;) {
    const rows = await delegateOf(column).findMany({
      select: { id: true, [column.field]: true },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });
    if (rows.length === 0) return;
    for (const r of rows) if (r[column.field] != null) yield { id: r.id, value: r[column.field] as Uint8Array };
    after = rows[rows.length - 1]!.id;
  }
}

/** Restricts a pass to some rows by id. The CLI never passes one; tests do, because they share a database with other test files. */
export type RowFilter = (rowId: string) => boolean;

export type KeyUsage = { column: string; keyId: number; count: number };

/** How many stored values each data key made, per column. keyId 0 is a value too short to be ciphertext at all. */
export async function keyUsage(opts: { filter?: RowFilter } = {}): Promise<KeyUsage[]> {
  const out: KeyUsage[] = [];
  for (const column of ENCRYPTED_COLUMNS) {
    const counts = new Map<number, number>();
    for await (const { id: rowId, value } of eachValue(column)) {
      if (opts.filter && !opts.filter(rowId)) continue;
      const id = ciphertextKeyId(value);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [keyId, count] of [...counts].sort((a, b) => a[0] - b[0])) out.push({ column: `${column.model}.${column.field}`, keyId, count });
  }
  return out;
}

/** Why a key cannot be retired yet: the columns that still hold values encrypted under it. Empty means it is safe. */
export async function retireBlockers(keyId: number, opts: { filter?: RowFilter } = {}): Promise<KeyUsage[]> {
  return (await keyUsage(opts)).filter((u) => u.keyId === keyId);
}

/** The ids of the data keys with at least one value still encrypted under them. */
export function idsInUse(usage: KeyUsage[]): number[] {
  return [...new Set(usage.map((u) => u.keyId))].sort((a, b) => a - b);
}

export type ReencryptResult = { examined: number; alreadyCurrent: number; reencrypted: number; skippedChangedMeanwhile: number; failed: Array<{ column: string; id: string; error: string }> };

/**
 * Re-encrypts every value not already under the current data key. Safe to stop and run again, and safe while the app is serving: each
 * row is written only if it still holds the exact bytes that were read (a value changed in the meantime is left for the next pass), and
 * the new bytes decrypt to the same text before they are stored. `apply: false` reports what would change without writing.
 */
export async function reencryptAll(opts: { apply: boolean; filter?: RowFilter; beforeWriteForTests?: (columnName: string, id: string) => Promise<void> }): Promise<ReencryptResult> {
  const { current } = activeFieldKeys();
  const result: ReencryptResult = { examined: 0, alreadyCurrent: 0, reencrypted: 0, skippedChangedMeanwhile: 0, failed: [] };
  for (const column of ENCRYPTED_COLUMNS) {
    for await (const { id, value } of eachValue(column)) {
      if (opts.filter && !opts.filter(id)) continue;
      result.examined += 1;
      if (ciphertextKeyId(value) === current) {
        result.alreadyCurrent += 1;
        continue;
      }
      try {
        const plaintext = decryptField(value);
        const next = encryptField(plaintext);
        if (decryptField(next) !== plaintext) throw new Error("re-encrypted value did not read back the same");
        if (opts.apply) {
          await opts.beforeWriteForTests?.(`${column.model}.${column.field}`, id);
          const { count } = await delegateOf(column).updateMany({ where: { id, [column.field]: Buffer.from(value) }, data: { [column.field]: next } });
          if (count === 1) result.reencrypted += 1;
          else result.skippedChangedMeanwhile += 1;
        } else {
          result.reencrypted += 1;
        }
      } catch (err) {
        result.failed.push({ column: `${column.model}.${column.field}`, id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return result;
}
