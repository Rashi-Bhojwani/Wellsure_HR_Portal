-- General-category visibility only. Existing categories retain their legacy path.
CREATE TABLE "helpdesk_category_visibility" (
  "id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "category_code" TEXT NOT NULL,
  "configured" BOOLEAN NOT NULL DEFAULT false,
  "hr_role_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "employee_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 0,
  "changed_by_user_id" TEXT,
  "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "helpdesk_category_visibility_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "peeps_visibility_no_payroll" CHECK ("category_code" <> 'PAYROLL_SALARY'),
  CONSTRAINT "peeps_visibility_state" CHECK (
    (NOT "configured" AND "version" = 0 AND cardinality("hr_role_codes") = 0 AND cardinality("employee_ids") = 0 AND "changed_by_user_id" IS NULL)
    OR ("configured" AND "version" > 0 AND "changed_by_user_id" IS NOT NULL)
  ),
  CONSTRAINT "helpdesk_category_visibility_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "helpdesk_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "helpdesk_category_visibility_category_id_key" ON "helpdesk_category_visibility"("category_id");

CREATE TABLE "helpdesk_category_visibility_history" (
  "id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "category_code" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "hr_role_codes" TEXT[] NOT NULL,
  "employee_ids" TEXT[] NOT NULL,
  "reason" TEXT NOT NULL,
  "changed_by_user_id" TEXT NOT NULL,
  "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "helpdesk_category_visibility_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "peeps_visibility_history_no_payroll" CHECK ("category_code" <> 'PAYROLL_SALARY'),
  CONSTRAINT "peeps_visibility_history_reason" CHECK (length(btrim("reason")) > 0 AND "version" > 0),
  CONSTRAINT "helpdesk_category_visibility_history_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "helpdesk_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "helpdesk_category_visibility_history_category_id_version_key" ON "helpdesk_category_visibility_history"("category_id", "version");

-- Always derive the checked code from the FK, so a forged code cannot bypass
-- either CHECK. The actor guard is also independent of application permissions.
CREATE FUNCTION peeps_helpdesk_visibility_category() RETURNS trigger AS $$
BEGIN
  SELECT code INTO NEW.category_code FROM helpdesk_categories WHERE id = NEW.category_id;
  IF NEW.changed_by_user_id IS NOT NULL AND NOT peeps_is_director(NEW.changed_by_user_id) THEN
    RAISE EXCEPTION 'HELPDESK_VISIBILITY_DIRECTORS_ONLY';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER peeps_visibility_category BEFORE INSERT OR UPDATE ON helpdesk_category_visibility FOR EACH ROW EXECUTE FUNCTION peeps_helpdesk_visibility_category();
CREATE TRIGGER peeps_visibility_history_category BEFORE INSERT ON helpdesk_category_visibility_history FOR EACH ROW EXECUTE FUNCTION peeps_helpdesk_visibility_category();
CREATE TRIGGER peeps_visibility_history_append_only BEFORE UPDATE OR DELETE ON helpdesk_category_visibility_history FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only();
CREATE TRIGGER peeps_visibility_history_no_truncate BEFORE TRUNCATE ON helpdesk_category_visibility_history FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only();

-- No backfill: only categories inserted AFTER this migration get Not set rows.
CREATE FUNCTION peeps_helpdesk_new_category() RETURNS trigger AS $$
BEGIN
  IF NEW.code <> 'PAYROLL_SALARY' THEN
    INSERT INTO helpdesk_category_visibility (id, category_id, category_code)
    VALUES (gen_random_uuid()::text, NEW.id, NEW.code);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER peeps_helpdesk_new_category AFTER INSERT ON helpdesk_categories FOR EACH ROW EXECUTE FUNCTION peeps_helpdesk_new_category();

-- The public API already keeps codes immutable. Direct SQL cannot turn a
-- category referenced by Peeps into Payroll behind the exclusion constraints.
CREATE FUNCTION peeps_helpdesk_protect_payroll_code() RETURNS trigger AS $$
BEGIN
  IF NEW.code = 'PAYROLL_SALARY' AND NEW.code IS DISTINCT FROM OLD.code AND (
    EXISTS (SELECT 1 FROM helpdesk_category_visibility WHERE category_id = OLD.id)
    OR EXISTS (SELECT 1 FROM helpdesk_category_visibility_history WHERE category_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'HELPDESK_VISIBILITY_PAYROLL_EXCLUDED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER peeps_helpdesk_protect_payroll_code BEFORE UPDATE OF code ON helpdesk_categories FOR EACH ROW EXECUTE FUNCTION peeps_helpdesk_protect_payroll_code();
