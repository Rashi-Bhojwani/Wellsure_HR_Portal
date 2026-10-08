-- CreateEnum
CREATE TYPE "DeviceRoute" AS ENUM ('AGENT', 'PUSH');

-- CreateEnum
CREATE TYPE "PunchRoute" AS ENUM ('AGENT', 'PUSH', 'IMPORT');

-- CreateEnum
CREATE TYPE "PunchFlag" AS ENUM ('FUTURE', 'TOO_OLD');

-- CreateEnum
CREATE TYPE "PunchFlagDecision" AS ENUM ('ACCEPTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "IngestionBatchStatus" AS ENUM ('PREVIEW', 'COMMITTED');

-- CreateTable
CREATE TABLE "biometric_agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "host" TEXT,
    "version" TEXT,
    "last_heartbeat_at" TIMESTAMP(3),
    "last_heartbeat" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "biometric_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "model" TEXT,
    "firmware" TEXT,
    "route" "DeviceRoute" NOT NULL DEFAULT 'AGENT',
    "agent_id" TEXT,
    "lan_ip" TEXT,
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_heartbeat_at" TIMESTAMP(3),
    "last_punch_at" TIMESTAMP(3),
    "last_received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_batches" (
    "id" TEXT NOT NULL,
    "route" "PunchRoute" NOT NULL,
    "status" "IngestionBatchStatus" NOT NULL DEFAULT 'COMMITTED',
    "device_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "uploaded_by_user_id" TEXT,
    "file_name" TEXT,
    "reason" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),
    "total_lines" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "unmapped_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_count" INTEGER NOT NULL DEFAULT 0,
    "flagged_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_lines" JSONB NOT NULL DEFAULT '[]',
    "pending_text" TEXT,

    CONSTRAINT "ingestion_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_punches" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "device_user_id" TEXT NOT NULL,
    "punched_at" TIMESTAMPTZ(3) NOT NULL,
    "local_time" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "status" TEXT NOT NULL,
    "verify_mode" TEXT NOT NULL,
    "workcode" TEXT NOT NULL,
    "reserved" TEXT NOT NULL,
    "raw_line" TEXT NOT NULL,
    "route" "PunchRoute" NOT NULL,
    "batch_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "employee_id" TEXT,
    "flag" "PunchFlag",

    CONSTRAINT "raw_punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punch_flag_resolutions" (
    "punch_id" TEXT NOT NULL,
    "decision" "PunchFlagDecision" NOT NULL,
    "reason" TEXT,
    "decided_by_user_id" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "punch_flag_resolutions_pkey" PRIMARY KEY ("punch_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "biometric_agents_key_hash_key" ON "biometric_agents"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "devices_serial_number_key" ON "devices"("serial_number");

-- CreateIndex
CREATE INDEX "devices_agent_id_idx" ON "devices"("agent_id");

-- CreateIndex
CREATE INDEX "ingestion_batches_device_id_received_at_idx" ON "ingestion_batches"("device_id", "received_at");

-- CreateIndex
CREATE INDEX "raw_punches_employee_id_punched_at_idx" ON "raw_punches"("employee_id", "punched_at");

-- CreateIndex
CREATE INDEX "raw_punches_device_user_id_business_date_idx" ON "raw_punches"("device_user_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "raw_punches_device_id_device_user_id_punched_at_key" ON "raw_punches"("device_id", "device_user_id", "punched_at");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "biometric_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "biometric_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_punches" ADD CONSTRAINT "raw_punches_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_punches" ADD CONSTRAINT "raw_punches_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ingestion_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_punches" ADD CONSTRAINT "raw_punches_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punch_flag_resolutions" ADD CONSTRAINT "punch_flag_resolutions_punch_id_fkey" FOREIGN KEY ("punch_id") REFERENCES "raw_punches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- raw_punches are immutable as received (spec §4.2, docs/plans/PHASE_2.md
-- §2.2). The only change ever allowed is re-resolving employee_id — a device
-- user ID mapped (or re-mapped) after its punches arrived. Every received
-- column stays exactly as it came. Deletion is refused, except the test
-- suite's fixture purge in a dev-marked database (wellsure_test_purge_allowed,
-- the same exception as audit_logs, E1.1).
CREATE OR REPLACE FUNCTION raw_punches_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'RAW_PUNCH_IMMUTABLE: raw punches can never be deleted';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'RAW_PUNCH_IMMUTABLE: raw punches can never be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.device_user_id IS DISTINCT FROM OLD.device_user_id
     OR NEW.punched_at IS DISTINCT FROM OLD.punched_at
     OR NEW.local_time IS DISTINCT FROM OLD.local_time
     OR NEW.business_date IS DISTINCT FROM OLD.business_date
     OR NEW.direction IS DISTINCT FROM OLD.direction
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.verify_mode IS DISTINCT FROM OLD.verify_mode
     OR NEW.workcode IS DISTINCT FROM OLD.workcode
     OR NEW.reserved IS DISTINCT FROM OLD.reserved
     OR NEW.raw_line IS DISTINCT FROM OLD.raw_line
     OR NEW.route IS DISTINCT FROM OLD.route
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.flag IS DISTINCT FROM OLD.flag THEN
    RAISE EXCEPTION 'RAW_PUNCH_IMMUTABLE: a raw punch can only have its employee re-resolved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER raw_punches_immutable
  BEFORE UPDATE OR DELETE ON "raw_punches"
  FOR EACH ROW EXECUTE FUNCTION raw_punches_immutable();

CREATE TRIGGER raw_punches_no_truncate
  BEFORE TRUNCATE ON "raw_punches"
  FOR EACH STATEMENT EXECUTE FUNCTION raw_punches_immutable();

-- The unmapped queue: punches whose device user ID had no mapping on the day.
CREATE INDEX raw_punches_unmapped ON raw_punches (device_user_id, punched_at) WHERE employee_id IS NULL;
