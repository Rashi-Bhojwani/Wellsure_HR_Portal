-- P7-7 (docs/plans/P7_7_FORM16.md): the TDS challan register (immutable, confirmed by a different director retyping it) and Form 16 confirmation per year.
ALTER TYPE "PayrollApprovalSubject" ADD VALUE 'FORM16_CONFIRM';
CREATE TABLE "tds_challans" (
    "id" TEXT NOT NULL,
    "financial_year" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "deposited_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "bsr_code" JSONB NOT NULL,
    "serial" JSONB NOT NULL,
    "serial_hash" TEXT NOT NULL,
    "bsr_last" TEXT NOT NULL,
    "serial_last" TEXT NOT NULL,
    "entered_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tds_challans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tds_challans_amount" CHECK ("amount" > 0),
    CONSTRAINT "tds_challans_month" CHECK ("month" ~ '^[0-9]{4}-[0-9]{2}$')
);
CREATE INDEX "tds_challans_financial_year_idx" ON "tds_challans"("financial_year");
CREATE TABLE "tds_challan_confirmations" (
    "id" TEXT NOT NULL,
    "challan_id" TEXT NOT NULL,
    "confirmed_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tds_challan_confirmations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tds_challan_confirmations_challan_id_key" ON "tds_challan_confirmations"("challan_id");
ALTER TABLE "tds_challan_confirmations" ADD CONSTRAINT "tds_challan_confirmations_challan_id_fkey" FOREIGN KEY ("challan_id") REFERENCES "tds_challans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION tds_challans_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'TDS_CHALLAN_IMMUTABLE: a challan record is never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tds_challans_guard BEFORE UPDATE OR DELETE ON "tds_challans" FOR EACH ROW EXECUTE FUNCTION tds_challans_immutable();
CREATE TRIGGER tds_challan_confirmations_guard BEFORE UPDATE OR DELETE ON "tds_challan_confirmations" FOR EACH ROW EXECUTE FUNCTION tds_challans_immutable();
-- The person who entered a challan never confirms it (the database holds it too).
CREATE FUNCTION tds_challan_confirmer_differs() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tds_challans c WHERE c.id = NEW.challan_id AND c.entered_by_user_id = NEW.confirmed_by_user_id) THEN
    RAISE EXCEPTION 'TDS_CHALLAN_SAME_PERSON: the person who entered a challan cannot confirm it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tds_challan_confirmer_check BEFORE INSERT ON "tds_challan_confirmations" FOR EACH ROW EXECUTE FUNCTION tds_challan_confirmer_differs();
