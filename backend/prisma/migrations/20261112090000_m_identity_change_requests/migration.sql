-- M session, task 1 (docs/plans/M_CHECKLIST.md): HR's bank and statutory entries wait for a director (decision b in docs/plans/HR_PAYROLL_SEPARATION.md §1).
-- Forward-only. The entry is stored already encrypted (the packed shape used by profile_change_requests.changes_json); no raw number is ever stored here.
CREATE TABLE "identity_change_requests" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "effective_from" DATE,
    "source" TEXT NOT NULL,
    "source_request_id" TEXT,
    "entered_by_user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_change_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "identity_change_requests_kind" CHECK ("kind" IN ('BANK', 'STATUTORY')),
    CONSTRAINT "identity_change_requests_source" CHECK ("source" IN ('HR_EDIT', 'ADD_EMPLOYEE', 'EMPLOYEE_REQUEST', 'DIRECTOR_EDIT')),
    CONSTRAINT "identity_change_requests_status" CHECK ("status" IN ('PENDING', 'CONFIRMED', 'REJECTED', 'WITHDRAWN')),
    CONSTRAINT "identity_change_requests_bank_date" CHECK (("kind" = 'BANK') = ("effective_from" IS NOT NULL)),
    CONSTRAINT "identity_change_requests_decided" CHECK (("status" = 'PENDING') = ("decided_by_user_id" IS NULL AND "decided_at" IS NULL)),
    -- A director never confirms or rejects what they entered (withdrawing your own entry is the one exception: the enterer decides WITHDRAWN).
    CONSTRAINT "identity_change_requests_other_person" CHECK ("status" IN ('PENDING', 'WITHDRAWN') OR "decided_by_user_id" <> "entered_by_user_id"),
    CONSTRAINT "identity_change_requests_withdrawn_by_enterer" CHECK ("status" <> 'WITHDRAWN' OR "decided_by_user_id" = "entered_by_user_id")
);

CREATE INDEX "identity_change_requests_status_created_at_idx" ON "identity_change_requests"("status", "created_at");
CREATE INDEX "identity_change_requests_employee_id_status_idx" ON "identity_change_requests"("employee_id", "status");
ALTER TABLE "identity_change_requests" ADD CONSTRAINT "identity_change_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A decided row never changes (its payload and its decision are the record), and nothing is deleted outside the test purge.
CREATE OR REPLACE FUNCTION identity_change_request_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'IDENTITY_CHANGE_KEPT: an identity change request is never deleted';
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'IDENTITY_CHANGE_DECIDED: a decided identity change request is never changed';
  END IF;
  IF NEW."payload" IS DISTINCT FROM OLD."payload" OR NEW."employee_id" <> OLD."employee_id" OR NEW."kind" <> OLD."kind"
     OR NEW."entered_by_user_id" <> OLD."entered_by_user_id" OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from" THEN
    RAISE EXCEPTION 'IDENTITY_CHANGE_FIXED: what was entered is never edited; withdraw it and enter it again';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "identity_change_requests_guard" BEFORE UPDATE OR DELETE ON "identity_change_requests" FOR EACH ROW EXECUTE FUNCTION identity_change_request_guard();

-- Decision b: HR Executive enters bank and statutory details as HR Admin does (masked, with an audited reveal).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('employee.bank.view', 'employee.bank.edit', 'employee.statutory.view', 'employee.statutory.edit')
WHERE r."code" = 'HR_EXECUTIVE'
ON CONFLICT DO NOTHING;
