-- The device-health check counts a device's punches for one business date every
-- minute, and the Devices screen reads the same pair. Only the unique
-- (device_id, device_user_id, punched_at) existed, so each run scanned that
-- device's whole history, which grows every month. No data changes.
CREATE INDEX "raw_punches_device_id_business_date_idx" ON "raw_punches"("device_id", "business_date");
