-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target_user_id" TEXT,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_user_id" TEXT,
    "acknowledgement_note" TEXT,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_events_acknowledged_at_idx" ON "security_events"("acknowledged_at");

-- CreateTable
CREATE TABLE "dev_database_marker" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dev_database_marker_pkey" PRIMARY KEY ("id")
);

-- ── Append-only enforcement (Phase 5 commit E1.1) ─────────────────────
-- Spec §9 has always said audit_logs is append-only; until now nothing
-- enforced it. These triggers refuse UPDATE, DELETE and TRUNCATE on
-- audit_logs, and every change to security_events except filling in the
-- acknowledgement once.
--
-- The one exception exists for the test suite's fixture cleanup: a session
-- that sets app.audit_purge = 'test' may delete, but ONLY in a database
-- whose dev_database_marker table has a row. That row is written only by
-- prisma/seed.ts, which refuses to run outside development —
-- staging/production are never seeded, so the table stays empty there.
--
-- Honest limit: these stop the application and casual edits. Someone with
-- the database owner's credentials can drop a trigger. The records that
-- survive that are the ones outside the database (spec §9).

CREATE OR REPLACE FUNCTION wellsure_test_purge_allowed() RETURNS boolean AS $$
  SELECT current_setting('app.audit_purge', true) = 'test'
     AND EXISTS (SELECT 1 FROM dev_database_marker);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY: audit log entries can never be changed or deleted (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();

-- The actor FK was ON DELETE SET NULL — an UPDATE the trigger would refuse,
-- so a user with audit history could never be deleted. Users are never
-- deleted in practice (they're deactivated), and an audit row must not
-- depend on anything else surviving: the actor id stays as plain text.
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_user_id_fkey";

CREATE OR REPLACE FUNCTION security_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'SECURITY_EVENT_APPEND_ONLY: security events can never be deleted';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'SECURITY_EVENT_APPEND_ONLY: security events can never be deleted';
  END IF;
  -- UPDATE: only the acknowledgement, only once, everything else unchanged.
  IF OLD.acknowledged_at IS NOT NULL
     OR NEW.acknowledged_at IS NULL
     OR NEW.acknowledged_by_user_id IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.details IS DISTINCT FROM OLD.details
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'SECURITY_EVENT_APPEND_ONLY: a security event can only be acknowledged, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER security_events_append_only
  BEFORE UPDATE OR DELETE ON "security_events"
  FOR EACH ROW EXECUTE FUNCTION security_events_append_only();

CREATE TRIGGER security_events_no_truncate
  BEFORE TRUNCATE ON "security_events"
  FOR EACH STATEMENT EXECUTE FUNCTION security_events_append_only();
