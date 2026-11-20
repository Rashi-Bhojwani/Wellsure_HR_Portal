-- FIX-H3 (independent audit 2026-11-20): the leave ledger is append-only at the database level, like audit_logs, security_events and payroll_events.
-- A balance is the sum of the ledger (spec §5.3), and paid leave becomes money at year-end encashment and at exit, so a row is never changed or
-- removed: a correction is a reversing entry (ADJUSTMENT/REVERSAL rows written by the application). The TRUNCATE trigger also makes the migrate task
-- revoke UPDATE, DELETE and TRUNCATE on the table from the application's database role (lib/dbRoles.ts, REQUIRED_APPEND_ONLY_TABLES).
-- The only exception is the test suite's fixture cleanup in a database the development seed marked (wellsure_test_purge_allowed, E1.1).
CREATE OR REPLACE FUNCTION leave_ledger_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'LEAVE_LEDGER_APPEND_ONLY: a leave ledger row is never changed or deleted; write a reversing entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_ledger_append_only BEFORE UPDATE OR DELETE ON "leave_ledger" FOR EACH ROW EXECUTE FUNCTION leave_ledger_append_only();
CREATE TRIGGER leave_ledger_no_truncate BEFORE TRUNCATE ON "leave_ledger" FOR EACH STATEMENT EXECUTE FUNCTION leave_ledger_append_only();
