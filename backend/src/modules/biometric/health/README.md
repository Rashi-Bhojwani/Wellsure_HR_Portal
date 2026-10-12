# modules/biometric/health

Device and agent health (Phase 2 P2-H, `docs/plans/PHASE_2.md` "P2-H build design", spec §4.7).

- `runner.ts`: `runDeviceHealthChecks(now)`, run every minute by the scheduler's `attendance-device-health` job. Opens and
  closes `device_incidents` from the current facts, then tells people. A pure function of the database and `now`.
- `windows.ts`: a branch's working window for a day, from the shifts of the people expected there (employed, device-mapped,
  not on a holiday, week-off or full-day leave). No one expected means no window, so nothing is alarmed.
- `incidents.ts`, `notify.ts`, `messages.ts`, `recovery.ts`: open/close, who is told (in-app to holders of
  `attendance.devices.manage`; email to them, the free list and, by setting, every active Super Admin), the words, and what
  a recovery notice says was missed.
- `queries.ts`, `people.ts`: what the Devices screen reads (incidents, per-route ingestion volume, people with no device ID).

Rules to keep: it never changes a device or an agent; at most one open incident per subject and kind (a unique index
enforces it); each notice is claimed with an update only one process can win, so it is sent at most once.
