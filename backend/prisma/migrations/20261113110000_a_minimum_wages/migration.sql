-- ST-29 (docs/plans/A_PARITY_ROWS.md part 2): minimum wage rates, each person's category and the pay heads compared — all entered by directors, none preset.
-- Every table is append-only (the newest row in force wins); the test purge exception applies.
CREATE TABLE "minimum_wage_rates" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "monthly_amount" DECIMAL(14,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "minimum_wage_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "minimum_wage_rates_amount" CHECK ("monthly_amount" > 0),
    CONSTRAINT "minimum_wage_rates_texts" CHECK (length("state") >= 1 AND length("category") >= 1 AND length("source") >= 3)
);
CREATE INDEX "minimum_wage_rates_state_category_effective_from_idx" ON "minimum_wage_rates"("state", "category", "effective_from");
CREATE TABLE "minimum_wage_categories" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "set_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "minimum_wage_categories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "minimum_wage_categories_employee_id_created_at_idx" ON "minimum_wage_categories"("employee_id", "created_at");
CREATE TABLE "minimum_wage_bases" (
    "id" TEXT NOT NULL,
    "head_codes" TEXT[] NOT NULL,
    "source" TEXT NOT NULL,
    "set_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "minimum_wage_bases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "minimum_wage_bases_heads" CHECK (cardinality("head_codes") >= 1 AND length("source") >= 3)
);
CREATE FUNCTION minimum_wages_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MINIMUM_WAGE_APPEND_ONLY: minimum wage records are never changed or deleted; enter a new one';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER minimum_wage_rates_guard BEFORE UPDATE OR DELETE ON "minimum_wage_rates" FOR EACH ROW EXECUTE FUNCTION minimum_wages_append_only();
CREATE TRIGGER minimum_wage_categories_guard BEFORE UPDATE OR DELETE ON "minimum_wage_categories" FOR EACH ROW EXECUTE FUNCTION minimum_wages_append_only();
CREATE TRIGGER minimum_wage_bases_guard BEFORE UPDATE OR DELETE ON "minimum_wage_bases" FOR EACH ROW EXECUTE FUNCTION minimum_wages_append_only();
