-- A-3 (docs/plans/A3_OPENING_FIGURES.md): opening figures — pay and tax for the financial year before this system (GO_LIVE) and from a previous employer
-- this year (PREVIOUS_EMPLOYER). Directors only. Append-only: the latest row per person, year and kind counts. Confirmed as a whole per year by a different
-- director through the approvals core (subject TAX_OPENING). Nothing seeded.
ALTER TYPE "PayrollApprovalSubject" ADD VALUE 'TAX_OPENING';
CREATE TYPE "TaxOpeningKind" AS ENUM ('GO_LIVE', 'PREVIOUS_EMPLOYER');
CREATE TABLE "tax_openings" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "employee_id" TEXT NOT NULL,
    "financial_year" TEXT NOT NULL,
    "kind" "TaxOpeningKind" NOT NULL,
    "taxable" DECIMAL(14,2),
    "tds" DECIMAL(14,2),
    "cleared" BOOLEAN NOT NULL DEFAULT false,
    "source_note" TEXT NOT NULL,
    "batch_id" TEXT,
    "entered_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tax_openings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_openings_year" CHECK ("financial_year" ~ '^[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT "tax_openings_figures" CHECK (("cleared" AND "taxable" IS NULL AND "tds" IS NULL) OR (NOT "cleared" AND "taxable" IS NOT NULL AND "tds" IS NOT NULL AND "taxable" >= 0 AND "tds" >= 0)),
    CONSTRAINT "tax_openings_note" CHECK (length(btrim("source_note")) >= 3)
);
CREATE UNIQUE INDEX "tax_openings_seq_key" ON "tax_openings"("seq");
CREATE INDEX "tax_openings_financial_year_employee_id_kind_seq_idx" ON "tax_openings"("financial_year", "employee_id", "kind", "seq");
ALTER TABLE "tax_openings" ADD CONSTRAINT "tax_openings_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION tax_openings_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'TAX_OPENING_APPEND_ONLY: an opening figure is never changed or deleted; enter a new one';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tax_openings_guard BEFORE UPDATE OR DELETE ON "tax_openings" FOR EACH ROW EXECUTE FUNCTION tax_openings_append_only();
