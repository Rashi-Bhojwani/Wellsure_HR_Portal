# infra

AWS CDK app (TypeScript) that provisions the staging and production
environments described in spec §15: `NetworkStack`, `DataStack`,
`AppStack`, `WebStack`, `EmailStack`, `ObservabilityStack`, `CiStack` and
(production-only) `BackupStack`.

Empty scaffold for now — `bin/` is the CDK app entrypoint, `lib/` has one
folder per stack. Implemented starting Phase 1.5 (staging) and hardened in
Phase 5.5 (production).

Full picture: `../docs/PROJECT_SPEC.md` §15.
