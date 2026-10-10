# service

The Windows side of the agent (P2-F commit F2). See `docs/plans/PHASE_2.md`,
"P2-F, commit F2 build design", and `../INSTALL.md` (in `biometric-agent/`).

- `eventLog.ts`: the Windows event log (source `WellsureAgent`, Application)
  through the system's `eventcreate`. One entry on service start/stop and on
  each change of retention state, log fill, clock drift, a batch set aside, or
  the agent key being rejected. The event IDs are fixed (`EVENT_IDS`) and
  listed in INSTALL.md.
- `status.ts`: what `wellsure-agent status` prints, in sentences, for the person
  at the PC.

The service itself is NSSM plus `windows/*.ps1`; the single executable is built by
`packaging/`.
