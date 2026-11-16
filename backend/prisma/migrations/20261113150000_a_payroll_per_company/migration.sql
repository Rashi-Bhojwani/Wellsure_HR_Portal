-- Part 3 B2 (docs/plans/A_PART3.md; owner decision 2026-11-13): payroll per company, first steps.
-- (a) A run is for one company: payroll_run_companies tags a run with a company (no tag = the main company). The tag is never changed.
-- (b) One live run per cycle PER COMPANY: the partial unique index "one live per cycle" becomes a deferred check that also counts the company, serialised by an advisory
--     lock so two creates at once still cannot both pass. With one company it refuses exactly what the index refused.
-- (c) Per-company statutory registrations and bank details: entered by one director, confirmed by a different one; nothing preset (Not set).
CREATE TABLE "payroll_run_companies" (
    "run_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_run_companies_pkey" PRIMARY KEY ("run_id")
);
CREATE INDEX "payroll_run_companies_legal_entity_id_idx" ON "payroll_run_companies"("legal_entity_id");
CREATE FUNCTION payroll_run_companies_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'PAYROLL_RUN_COMPANY_IMMUTABLE: a run''s company is never changed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_run_companies_guard BEFORE UPDATE OR DELETE ON "payroll_run_companies" FOR EACH ROW EXECUTE FUNCTION payroll_run_companies_immutable();

DROP INDEX "payroll_runs_one_live_per_cycle";
CREATE FUNCTION payroll_run_live_per_company_check() RETURNS trigger AS $$
DECLARE
  r payroll_runs%ROWTYPE;
  company TEXT;
  live INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'payroll_runs' THEN SELECT * INTO r FROM payroll_runs WHERE id = NEW.id; ELSE SELECT * INTO r FROM payroll_runs WHERE id = NEW.run_id; END IF;
  IF r.id IS NULL OR r.status = 'VOID' THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('payroll-run-live:' || r.cycle_start::text || ':' || r.cycle_end::text));
  SELECT coalesce((SELECT legal_entity_id FROM payroll_run_companies WHERE run_id = r.id), 'MAIN') INTO company;
  SELECT count(*) INTO live FROM payroll_runs x LEFT JOIN payroll_run_companies c ON c.run_id = x.id
    WHERE x.status <> 'VOID' AND x.cycle_start = r.cycle_start AND x.cycle_end = r.cycle_end AND coalesce(c.legal_entity_id, 'MAIN') = company;
  IF live > 1 THEN
    RAISE EXCEPTION 'PAYROLL_RUN_EXISTS: there is already a live payroll run for this cycle and company' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER payroll_runs_live_per_company AFTER INSERT OR UPDATE OF status, cycle_start, cycle_end ON "payroll_runs" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll_run_live_per_company_check();
CREATE CONSTRAINT TRIGGER payroll_run_companies_live_per_company AFTER INSERT ON "payroll_run_companies" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll_run_live_per_company_check();

CREATE TABLE "payroll_company_settings" (
    "id" TEXT NOT NULL,
    "company_key" TEXT NOT NULL,
    "registrations" JSONB NOT NULL,
    "debit_account" JSONB,
    "debit_account_last4" TEXT,
    "reason" TEXT NOT NULL,
    "entered_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_company_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_company_settings_reason" CHECK (length("reason") >= 3)
);
CREATE INDEX "payroll_company_settings_company_key_created_at_idx" ON "payroll_company_settings"("company_key", "created_at");
CREATE TABLE "payroll_company_setting_confirmations" (
    "id" TEXT NOT NULL,
    "setting_id" TEXT NOT NULL,
    "confirmed_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_company_setting_confirmations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_company_setting_confirmations_setting_id_key" ON "payroll_company_setting_confirmations"("setting_id");
ALTER TABLE "payroll_company_setting_confirmations" ADD CONSTRAINT "payroll_company_setting_confirmations_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "payroll_company_settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION payroll_company_settings_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'PAYROLL_COMPANY_SETTING_IMMUTABLE: company settings are never changed or deleted; enter new ones';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_company_settings_guard BEFORE UPDATE OR DELETE ON "payroll_company_settings" FOR EACH ROW EXECUTE FUNCTION payroll_company_settings_immutable();
CREATE TRIGGER payroll_company_setting_confirmations_guard BEFORE UPDATE OR DELETE ON "payroll_company_setting_confirmations" FOR EACH ROW EXECUTE FUNCTION payroll_company_settings_immutable();
CREATE FUNCTION payroll_company_setting_confirmer_differs() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM payroll_company_settings s WHERE s.id = NEW.setting_id AND s.entered_by_user_id = NEW.confirmed_by_user_id) THEN
    RAISE EXCEPTION 'PAYROLL_COMPANY_SETTING_SAME_PERSON: the director who entered company settings cannot confirm them';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_company_setting_confirmer_check BEFORE INSERT ON "payroll_company_setting_confirmations" FOR EACH ROW EXECUTE FUNCTION payroll_company_setting_confirmer_differs();
