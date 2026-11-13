-- ST-03 / ST-06 (docs/plans/A_PARITY_ROWS.md): PF and ESI challan records, like the TDS challans (P7-7). The challan reference is sealed (shown by its last four),
-- a keyed hash refuses the same reference twice for the same statute, the record is immutable, and the director who entered it never confirms it.
CREATE TABLE "statutory_challans" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "deposited_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" JSONB NOT NULL,
    "reference_hash" TEXT NOT NULL,
    "reference_last" TEXT NOT NULL,
    "entered_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "statutory_challans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "statutory_challans_kind" CHECK ("kind" IN ('PF', 'ESI')),
    CONSTRAINT "statutory_challans_amount" CHECK ("amount" > 0),
    CONSTRAINT "statutory_challans_month" CHECK ("month" ~ '^[0-9]{4}-[0-9]{2}$')
);
CREATE UNIQUE INDEX "statutory_challans_kind_reference_hash_key" ON "statutory_challans"("kind", "reference_hash");
CREATE INDEX "statutory_challans_kind_month_idx" ON "statutory_challans"("kind", "month");
CREATE TABLE "statutory_challan_confirmations" (
    "id" TEXT NOT NULL,
    "challan_id" TEXT NOT NULL,
    "confirmed_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "statutory_challan_confirmations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "statutory_challan_confirmations_challan_id_key" ON "statutory_challan_confirmations"("challan_id");
ALTER TABLE "statutory_challan_confirmations" ADD CONSTRAINT "statutory_challan_confirmations_challan_id_fkey" FOREIGN KEY ("challan_id") REFERENCES "statutory_challans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION statutory_challans_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'STATUTORY_CHALLAN_IMMUTABLE: a challan record is never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER statutory_challans_guard BEFORE UPDATE OR DELETE ON "statutory_challans" FOR EACH ROW EXECUTE FUNCTION statutory_challans_immutable();
CREATE TRIGGER statutory_challan_confirmations_guard BEFORE UPDATE OR DELETE ON "statutory_challan_confirmations" FOR EACH ROW EXECUTE FUNCTION statutory_challans_immutable();
CREATE FUNCTION statutory_challan_confirmer_differs() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM statutory_challans c WHERE c.id = NEW.challan_id AND c.entered_by_user_id = NEW.confirmed_by_user_id) THEN
    RAISE EXCEPTION 'STATUTORY_CHALLAN_SAME_PERSON: the person who entered a challan cannot confirm it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER statutory_challan_confirmer_check BEFORE INSERT ON "statutory_challan_confirmations" FOR EACH ROW EXECUTE FUNCTION statutory_challan_confirmer_differs();
