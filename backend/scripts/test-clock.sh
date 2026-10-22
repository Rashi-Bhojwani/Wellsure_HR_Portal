#!/usr/bin/env bash
# Runs the whole backend suite as if the wall clock read each of the given instants (or a default set), to find tests that
# quietly depend on the hour, day, month or year they run in. See vitest.fakeClock.ts and docs/GETTING_STARTED.md.
#
#   npm run test:clock                                  # the default instants below, one full run each
#   npm run test:clock -- 2027-01-01T00:10:00+05:30     # just this instant
#
# Each run uses its own database (wellsure_hr_clock) and Redis db 14, so it does not disturb a normal `npm test`.
# Only JavaScript's clock moves: the database's now() and Prisma's @default(now()) stay real, so a test that compares a
# stored createdAt with Date.now() will fail under any fake instant. Fix that test (do not compare the two clocks).
set -uo pipefail
cd "$(dirname "$0")/.."
if [ "$#" -gt 0 ]; then instants=("$@"); else
  instants=(
    "2026-10-15T18:40:00Z"  # 00:10 IST: UTC is still yesterday, the day just rolled over in business time
    "2026-12-31T18:40:00Z"  # 00:10 IST on 1 January: a year boundary in business time
    "2027-06-15T05:30:00Z"  # an ordinary midday months later
    "2028-02-29T05:30:00Z"  # a leap day, over a year ahead (fixed-date tests start to age out here)
    "2030-06-15T05:30:00Z"  # years ahead
  )
fi
# Which server the runs connect to. With a backend/.env (a developer's machine) its DATABASE_URL is used and any exported one is
# dropped, because an exported URL (a cloud container's) silently wins over .env. Without one (a fresh CI checkout, until the
# workflow writes one) the exported DATABASE_URL is the only source, so it must be kept. Until 2026-10-22 the script dropped it
# unconditionally, and every scheduled CI run failed on configuration before a single test ran.
if [ -f .env ]; then
  drop=(-u DATABASE_URL -u PORT)
elif [ -n "${DATABASE_URL:-}" ]; then
  drop=(-u PORT)
else
  echo "test:clock: no backend/.env and no DATABASE_URL: nothing to connect to." >&2
  exit 2
fi
# Prove the configuration loads once, before spending minutes per instant on a run that cannot start.
if ! env "${drop[@]}" TEST_DATABASE_NAME=wellsure_hr_clock REDIS_TEST_DB=14 npx tsx -e 'import("./src/config/env").then(() => console.log("test:clock: configuration loads"))'; then
  echo "test:clock: the configuration does not load, so no instant was run." >&2
  exit 2
fi
failed=0
passed=0
for at in "${instants[@]}"; do
  echo "=== wall clock = $at ==="
  if TEST_FAKE_NOW="$at" TEST_DATABASE_NAME=wellsure_hr_clock REDIS_TEST_DB=14 env "${drop[@]}" npx vitest run; then passed=$((passed + 1)); else failed=1; fi
done
echo "test:clock: ${passed} of ${#instants[@]} instants passed"
exit $failed
