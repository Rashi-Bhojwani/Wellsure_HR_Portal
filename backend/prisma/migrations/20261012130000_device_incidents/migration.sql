-- P2-H (docs/plans/PHASE_2.md "P2-H build design"): device and agent incidents.

CREATE TYPE "DeviceIncidentKind" AS ENUM ('DEVICE_SILENT', 'AGENT_SILENT', 'NO_PUNCHES_TODAY', 'CLOCK_DRIFT', 'RETENTION_RISK');

CREATE TABLE "device_incidents" (
    "id" TEXT NOT NULL,
    "kind" "DeviceIncidentKind" NOT NULL,
    "device_id" TEXT,
    "agent_id" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "last_contact_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "details" JSONB NOT NULL DEFAULT '{}',
    "open_notified_at" TIMESTAMP(3),
    "escalate_after" TIMESTAMP(3),
    "escalated_at" TIMESTAMP(3),
    "recovery_notified_at" TIMESTAMP(3),
    "recovery_summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_incidents_resolved_at_idx" ON "device_incidents"("resolved_at");
CREATE INDEX "device_incidents_device_id_opened_at_idx" ON "device_incidents"("device_id", "opened_at");
CREATE INDEX "device_incidents_agent_id_opened_at_idx" ON "device_incidents"("agent_id", "opened_at");

ALTER TABLE "device_incidents" ADD CONSTRAINT "device_incidents_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_incidents" ADD CONSTRAINT "device_incidents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "biometric_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one subject: the agent for AGENT_SILENT, the device for every other kind.
ALTER TABLE "device_incidents" ADD CONSTRAINT "device_incidents_one_subject" CHECK (
    ("kind" = 'AGENT_SILENT' AND "agent_id" IS NOT NULL AND "device_id" IS NULL)
    OR ("kind" <> 'AGENT_SILENT' AND "device_id" IS NOT NULL AND "agent_id" IS NULL)
);

-- At most one OPEN incident per subject and kind: a check that runs every minute cannot open the same one twice.
CREATE UNIQUE INDEX "device_incidents_one_open" ON "device_incidents" ("kind", COALESCE("device_id", "agent_id")) WHERE "resolved_at" IS NULL;
