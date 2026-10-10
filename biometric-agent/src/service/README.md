# service

The Windows service wrapper (P2-F commit F2): a single executable under NSSM
(start on boot, restart on failure, log rotation), running as its own
low-privilege account with the agent key and comm keys in that account's
Credential Manager, and Windows event-log entries for the retention and
clock-drift alarms. See `docs/plans/PHASE_2.md`, "P2-F build design".
