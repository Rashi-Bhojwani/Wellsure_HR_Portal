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
failed=0
for at in "${instants[@]}"; do
  echo "=== wall clock = $at ==="
  TEST_FAKE_NOW="$at" TEST_DATABASE_NAME=wellsure_hr_clock REDIS_TEST_DB=14 env -u DATABASE_URL -u PORT npx vitest run || failed=1
done
exit $failed
