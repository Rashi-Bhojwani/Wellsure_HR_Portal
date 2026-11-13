#!/usr/bin/env bash
# Peeps phase-end check (owner's speed rule, 2026-11-12): run ONCE at the end of a phase (a group of rows or a stage), not
# after every commit. Stops at the first failed step and exits non-zero.
#
#   scripts/peeps-check.sh --since <git-ref>          lint + typecheck + the backend/frontend test files changed since <ref>
#   scripts/peeps-check.sh --since <ref> --full       ... then the FULL backend suite, alone (end of stage / before a merge)
#   scripts/peeps-check.sh -- <test files...>         lint + typecheck + exactly these test files
#
# Never points at a remote database: DATABASE_URL, DATABASE_SSL and PORT are unset first. The test run uses its own isolated
# database and Redis database (backend/vitest.globalSetup.ts) and refuses if another test run holds them.
set -euo pipefail
unset DATABASE_URL DATABASE_SSL PORT
# Keep whatever NODE_OPTIONS the environment sets (for example its CA settings) and add a heap size unless one is already there.
case " ${NODE_OPTIONS:-} " in *"--max-old-space-size"*) ;; *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=8192" ;; esac
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

since=""; full=0; files=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) since="${2:?--since needs a git ref}"; shift 2 ;;
    --full) full=1; shift ;;
    --) shift; files+=("$@"); break ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ -n "$since" ]]; then
  git rev-parse --verify --quiet "$since^{commit}" >/dev/null || { echo "not a commit: $since" >&2; exit 2; }
  while IFS= read -r f; do [[ -f "$f" ]] && files+=("$f"); done < <(git diff --name-only "$since" -- 'backend/src/**/*.test.ts' 'frontend/src/**/*.test.ts' 'frontend/src/**/*.test.tsx'; git ls-files --others --exclude-standard -- 'backend/src/**/*.test.ts' 'frontend/src/**/*.test.ts' 'frontend/src/**/*.test.tsx')
fi

step() { echo; echo "== $1"; }
step "lint (ESLint + check:tokens)"; npm run lint
step "typecheck (backend, frontend, agent, infra)"; npm run typecheck

backend=(); frontend=()
for f in "${files[@]+"${files[@]}"}"; do
  case "$f" in backend/*) backend+=("${f#backend/}") ;; frontend/*) frontend+=("${f#frontend/}") ;; esac
done
if [[ ${#backend[@]} -gt 0 ]]; then step "backend tests changed (${#backend[@]} files)"; (cd backend && npx vitest run "${backend[@]}"); else step "backend tests changed: none"; fi
if [[ ${#frontend[@]} -gt 0 ]]; then step "frontend tests changed (${#frontend[@]} files)"; (cd frontend && npx vitest run "${frontend[@]}"); else step "frontend tests changed: none"; fi
if [[ $full -eq 1 ]]; then step "FULL backend suite, alone"; (cd backend && npm test); fi
echo; echo "== all steps passed"
