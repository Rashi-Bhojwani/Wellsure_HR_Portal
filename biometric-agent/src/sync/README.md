# sync

The agent (`agent.ts`): one loop per device, a sender and a heartbeat.

- `cursor.ts` — position plus fingerprint, never a timestamp; cheap polling.
- `outbox.ts` — records written durably before the cursor moves; deleted only
  on the API's acknowledgement; a refused batch is set aside, never deleted.
- `state.ts` / `files.ts` — `state.json`, written durably.
- `backoff.ts`, `clock.ts` — retries, and device/PC/server clock offsets.
