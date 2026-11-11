-- P7-5 (docs/plans/P7_5_REIMBURSEMENTS.md): reimbursements. Immutable rows; one decision per claim. Nothing seeded.
ALTER TYPE "AdjustmentSource" ADD VALUE 'REIMBURSEMENT';

CREATE TABLE "claim_type_versions" (
    "id" TEXT NOT NULL,
    "type_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "employees_may_claim" BOOLEAN,
    "bills_required" BOOLEAN,
    "monthly_cap_set" BOOLEAN NOT NULL DEFAULT false,
    "monthly_cap" DECIMAL(14,2),
    "yearly_cap_set" BOOLEAN NOT NULL DEFAULT false,
    "yearly_cap" DECIMAL(14,2),
    "pay_head" TEXT,
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "set_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "claim_type_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "claim_type_versions_caps" CHECK ((NOT "monthly_cap_set" AND "monthly_cap" IS NULL) OR ("monthly_cap_set" AND ("monthly_cap" IS NULL OR "monthly_cap" > 0))) ,
    CONSTRAINT "claim_type_versions_ycaps" CHECK ((NOT "yearly_cap_set" AND "yearly_cap" IS NULL) OR ("yearly_cap_set" AND ("yearly_cap" IS NULL OR "yearly_cap" > 0)))
);
CREATE UNIQUE INDEX "claim_type_versions_type_key_version_key" ON "claim_type_versions"("type_key", "version");

CREATE TABLE "reimbursement_claims" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type_key" TEXT NOT NULL,
    "type_version" INTEGER NOT NULL,
    "spent_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "bills" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reimbursement_claims_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reimbursement_claims_amount" CHECK ("amount" > 0)
);
CREATE INDEX "reimbursement_claims_employee_id_idx" ON "reimbursement_claims"("employee_id");
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "ClaimDecisionKind" AS ENUM ('APPROVED', 'REJECTED', 'WITHDRAWN');
CREATE TABLE "claim_decisions" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "kind" "ClaimDecisionKind" NOT NULL,
    "approved_amount" DECIMAL(14,2),
    "reason" TEXT NOT NULL DEFAULT '',
    "decided_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "claim_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "claim_decisions_amount" CHECK (("kind" = 'APPROVED' AND "approved_amount" > 0) OR ("kind" <> 'APPROVED' AND "approved_amount" IS NULL))
);
CREATE UNIQUE INDEX "claim_decisions_claim_id_key" ON "claim_decisions"("claim_id");
ALTER TABLE "claim_decisions" ADD CONSTRAINT "claim_decisions_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "reimbursement_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reimbursement_rows_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'REIMBURSEMENT_RECORD_IMMUTABLE: reimbursement records are never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER claim_type_versions_guard BEFORE UPDATE OR DELETE ON "claim_type_versions" FOR EACH ROW EXECUTE FUNCTION reimbursement_rows_immutable();
CREATE TRIGGER reimbursement_claims_guard BEFORE UPDATE OR DELETE ON "reimbursement_claims" FOR EACH ROW EXECUTE FUNCTION reimbursement_rows_immutable();
CREATE TRIGGER claim_decisions_guard BEFORE UPDATE OR DELETE ON "claim_decisions" FOR EACH ROW EXECUTE FUNCTION reimbursement_rows_immutable();
