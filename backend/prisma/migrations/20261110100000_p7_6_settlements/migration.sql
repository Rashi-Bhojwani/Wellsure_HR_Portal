-- P7-6 (docs/plans/P7_6_SETTLEMENTS.md): full and final settlements. Immutable; the latest per separation counts; confirmed by a different director.
ALTER TYPE "PayrollApprovalSubject" ADD VALUE 'FNF_SETTLEMENT';
CREATE TABLE "fnf_settlements" (
    "id" TEXT NOT NULL,
    "separation_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fnf_settlements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fnf_settlements_separation_id_idx" ON "fnf_settlements"("separation_id");
ALTER TABLE "fnf_settlements" ADD CONSTRAINT "fnf_settlements_separation_id_fkey" FOREIGN KEY ("separation_id") REFERENCES "separations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fnf_settlements" ADD CONSTRAINT "fnf_settlements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION fnf_settlements_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'FNF_SETTLEMENT_IMMUTABLE: a settlement is never changed or deleted; prepare a new one';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fnf_settlements_guard BEFORE UPDATE OR DELETE ON "fnf_settlements" FOR EACH ROW EXECUTE FUNCTION fnf_settlements_immutable();
