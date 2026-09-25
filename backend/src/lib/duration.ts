const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

// Parses "15m", "30d", etc. (the same shorthand jsonwebtoken's expiresIn
// accepts) into milliseconds, for the refresh-token expiry we track
// manually in the database rather than as a JWT claim.
export function parseDurationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration string: "${value}" (expected e.g. "15m", "30d")`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit!]!;
}
