-- Phase 2 commit P2-F (F1): what the sync agent needs from each device's
-- record, and what it reports back (docs/plans/PHASE_2.md "P2-F build design").

-- "Sync punches from" (D-F3): existing devices get the day they were
-- registered (IST), the same default a new device gets, so the first sync
-- never sends the device's whole history.
ALTER TABLE "devices" ADD COLUMN "sync_from" DATE;
UPDATE "devices" SET "sync_from" = (("created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date;
ALTER TABLE "devices" ALTER COLUMN "sync_from" SET NOT NULL;
-- Any insert path (the admin screen sets it explicitly) gets today in IST.
ALTER TABLE "devices" ALTER COLUMN "sync_from" SET DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata'::text))::date;

-- The device's log retention, pessimistic until the model is known (§7.1).
ALTER TABLE "devices"
  ADD COLUMN "retention_days" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "retention_records" INTEGER NOT NULL DEFAULT 20000,
  ADD CONSTRAINT "devices_retention_days_check" CHECK ("retention_days" BETWEEN 1 AND 365),
  ADD CONSTRAINT "devices_retention_records_check" CHECK ("retention_records" BETWEEN 100 AND 10000000);

-- The agent's latest report on the device.
ALTER TABLE "devices"
  ADD COLUMN "agent_report" JSONB,
  ADD COLUMN "agent_report_at" TIMESTAMP(3);

-- Device-health thresholds (System Settings → Attendance → Device health).
-- On every database, not only the dev seed, like the P2-A defaults.
INSERT INTO system_settings (key, value, updated_at)
VALUES ('attendance.deviceHealth', '{"retentionWarningPercent":50,"retentionAlarmPercent":75,"logNearlyFullPercent":90,"clockDriftWarningSeconds":120}', now())
ON CONFLICT (key) DO NOTHING;
