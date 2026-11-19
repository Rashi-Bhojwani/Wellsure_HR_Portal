#!/usr/bin/env bash
# Lateness rule mutation checks (docs/plans/LATE_CHECKLIST.md §8). Each mutation breaks one rule on purpose; the lateness tests must FAIL ("killed").
# A mutation the tests do not notice ("survived") makes the script exit 1. Every file is restored from a copy after each mutation, whatever happens.
# Run from backend/ against the local test services:  bash scripts/late-mutation-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
unset DATABASE_URL PORT
TESTS="src/modules/lateness/__tests__"
BACKUP="$(mktemp -d)"
survived=0

mutate() { # name, file, from, to
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" "$BACKUP/orig"
  if ! FROM="$from" TO="$to" python3 -c 'import os,sys; p=sys.argv[1]; s=open(p).read(); f=os.environ["FROM"]; assert s.count(f)==1, "pattern not found once"; open(p,"w").write(s.replace(f, os.environ["TO"]))' "$file"; then
    echo "ERROR  $name: the pattern to mutate is not in $file"; cp "$BACKUP/orig" "$file"; survived=1; return
  fi
  if npx vitest run "$TESTS" >"$BACKUP/out" 2>&1; then echo "SURVIVED  $name"; survived=1; else echo "KILLED    $name ($(grep -c '✗\|FAIL' "$BACKUP/out") failing lines)"; fi
  cp "$BACKUP/orig" "$file"
}

E=src/modules/lateness/evaluate.ts
H=src/modules/lateness/dayHook.ts
S=src/modules/lateness/settings.ts
P=src/modules/lateness/penalties.ts
mutate "allowance off by one" $E 'n <= b.applies.free' 'n < b.applies.free'
mutate "edge flipped" $E 'c.edge === "INCLUSIVE" ? minute >= m : minute > m' 'c.edge === "INCLUSIVE" ? minute > m : minute >= m'
mutate "penalty added instead of the higher-of" $P 'return max(ZERO, penalty.minus(hoursValue));' 'return penalty;'
mutate "salary cut added instead of the higher-of" $E 'return Math.max(0, cut - hoursLop);' 'return cut;'
mutate "waiver not returning the allowance" $E 'if (waived.has(a.date)) {' 'if (waived.has(a.date) && (seen[band - 1]! += 1)) {'
mutate "module active while off" $S 'rule: r && r.active ? r : null' 'rule: r'
mutate "'no consequence' deducting" $E 'else consequence = { kind: b.outcome.kind };' 'else consequence = b.outcome.kind === "NONE" ? { kind: "CUT", days: 0.5 } : { kind: b.outcome.kind };'
mutate "penalty line and salary cut both on one arrival" $H 'if (today2?.consequence.kind !== "CUT") return r;
    const add = cutToAdd(today2.consequence.days,' 'if (today2?.consequence.kind !== "CUT" && today2?.consequence.kind !== "PENALTY") return r;
    const add = cutToAdd(today2.consequence.kind === "CUT" ? today2.consequence.days : 0.5,'

rm -rf "$BACKUP"
git diff --quiet -- src/modules/lateness || { echo "ERROR: a lateness file was left changed"; exit 1; }
exit $survived
