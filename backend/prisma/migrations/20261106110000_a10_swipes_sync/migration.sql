-- A-10 G5 (docs/plans/GREYTHR_PARITY_WORKFORCE.md items 13, 14).
-- A swipe decision: reject a punch (the engine then ignores it) or reinstate it, with a reason. Append-only; the latest decision of a punch is in force.
CREATE TYPE "SwipeDecisionAction" AS ENUM ('REJECT', 'REINSTATE');
CREATE TABLE "swipe_decisions" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "punch_id" TEXT NOT NULL,
    "action" "SwipeDecisionAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "decided_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "swipe_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "swipe_decisions_reason" CHECK (length(btrim("reason")) >= 3)
);
CREATE UNIQUE INDEX "swipe_decisions_seq_key" ON "swipe_decisions"("seq");
CREATE INDEX "swipe_decisions_punch_id_seq_idx" ON "swipe_decisions"("punch_id", "seq");
ALTER TABLE "swipe_decisions" ADD CONSTRAINT "swipe_decisions_punch_id_fkey" FOREIGN KEY ("punch_id") REFERENCES "raw_punches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION swipe_decisions_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'SWIPE_DECISION_APPEND_ONLY: a swipe decision is never changed or deleted; add a new one';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER swipe_decisions_guard BEFORE UPDATE OR DELETE ON "swipe_decisions" FOR EACH ROW EXECUTE FUNCTION swipe_decisions_append_only();

-- A sync request: ask the agent that reads a device to read it again for a date range. PENDING until the agent reports it done, or cancelled.
CREATE TYPE "DeviceSyncStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');
CREATE TABLE "device_sync_requests" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DeviceSyncStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" TEXT,
    CONSTRAINT "device_sync_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "device_sync_requests_range" CHECK ("from_date" <= "to_date"),
    CONSTRAINT "device_sync_requests_finished" CHECK (("status" = 'PENDING') = ("finished_at" IS NULL))
);
CREATE INDEX "device_sync_requests_device_id_status_idx" ON "device_sync_requests"("device_id", "status");
ALTER TABLE "device_sync_requests" ADD CONSTRAINT "device_sync_requests_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Only the status moves, once, from PENDING; nothing else changes and nothing is deleted.
CREATE FUNCTION device_sync_requests_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'DEVICE_SYNC_APPEND_ONLY: a sync request is never deleted; cancel it';
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.device_id IS DISTINCT FROM OLD.device_id OR NEW.from_date IS DISTINCT FROM OLD.from_date OR NEW.to_date IS DISTINCT FROM OLD.to_date
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'DEVICE_SYNC_APPEND_ONLY: only a pending request''s status moves, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER device_sync_requests_guard BEFORE UPDATE OR DELETE ON "device_sync_requests" FOR EACH ROW EXECUTE FUNCTION device_sync_requests_guard();
