-- P7-4 (docs/plans/P7_4_LOANS.md): loans and advances. Directors only. Nothing seeded.
ALTER TYPE "PayrollApprovalSubject" ADD VALUE 'LOAN_SANCTION';
ALTER TYPE "PayrollApprovalSubject" ADD VALUE 'LOAN_CHANGE';
ALTER TYPE "AdjustmentSource" ADD VALUE 'LOAN_DISBURSEMENT';
ALTER TYPE "AdjustmentSource" ADD VALUE 'LOAN_PRINCIPAL';
ALTER TYPE "AdjustmentSource" ADD VALUE 'LOAN_INTEREST';

-- A loan type: append-only versions; the latest counts; retiring is a version.
CREATE TABLE "loan_type_versions" (
    "id" TEXT NOT NULL,
    "type_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "max_amount" DECIMAL(14,2),
    "max_instalments" INTEGER,
    "rate_percent" DECIMAL(7,4),
    "employees_may_request" BOOLEAN,
    "disbursement_head" TEXT,
    "principal_head" TEXT,
    "interest_head" TEXT,
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "set_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loan_type_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loan_type_versions_figures" CHECK (("max_amount" IS NULL OR "max_amount" > 0) AND ("max_instalments" IS NULL OR "max_instalments" > 0) AND ("rate_percent" IS NULL OR "rate_percent" >= 0))
);
CREATE UNIQUE INDEX "loan_type_versions_type_key_version_key" ON "loan_type_versions"("type_key", "version");

-- A loan: immutable once written. What happened to it is its approval (LOAN_SANCTION), its changes, and its adjustments.
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type_key" TEXT NOT NULL,
    "type_version" INTEGER NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "rate_percent" DECIMAL(7,4) NOT NULL,
    "instalments" INTEGER NOT NULL,
    "first_month" DATE NOT NULL,
    "schedule" JSONB NOT NULL,
    "purpose" TEXT NOT NULL,
    "requested_by_employee" BOOLEAN NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loans_figures" CHECK ("principal" > 0 AND "rate_percent" >= 0 AND "instalments" > 0 AND extract(day FROM "first_month") = 1)
);
CREATE INDEX "loans_employee_id_idx" ON "loans"("employee_id");
ALTER TABLE "loans" ADD CONSTRAINT "loans_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A change to a sanctioned loan, prepared by one director and approved by a different one (LOAN_CHANGE). Immutable.
CREATE TYPE "LoanChangeKind" AS ENUM ('PREPAID', 'WAIVED', 'CANCEL_PENDING');
CREATE TABLE "loan_changes" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "kind" "LoanChangeKind" NOT NULL,
    "amount" DECIMAL(14,2),
    "reference" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loan_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loan_changes_amount" CHECK (("kind" = 'CANCEL_PENDING' AND "amount" IS NULL) OR ("kind" <> 'CANCEL_PENDING' AND "amount" > 0)),
    CONSTRAINT "loan_changes_reference" CHECK (length(btrim("reference")) >= 3)
);
CREATE INDEX "loan_changes_loan_id_idx" ON "loan_changes"("loan_id");
ALTER TABLE "loan_changes" ADD CONSTRAINT "loan_changes_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION loans_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'LOAN_RECORD_IMMUTABLE: loan records are never changed or deleted; add a change';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER loan_type_versions_guard BEFORE UPDATE OR DELETE ON "loan_type_versions" FOR EACH ROW EXECUTE FUNCTION loans_immutable();
CREATE TRIGGER loans_guard BEFORE UPDATE OR DELETE ON "loans" FOR EACH ROW EXECUTE FUNCTION loans_immutable();
CREATE TRIGGER loan_changes_guard BEFORE UPDATE OR DELETE ON "loan_changes" FOR EACH ROW EXECUTE FUNCTION loans_immutable();
