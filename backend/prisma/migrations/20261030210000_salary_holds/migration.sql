-- Stage 3.3c: a director's hold on a person's salary for a month, and its release. Append-only; only a Super Admin writes either.
ALTER TYPE "AdjustmentSource" ADD VALUE IF NOT EXISTS 'HOLD_RELEASE';
ALTER TYPE "PayrollLineSource" ADD VALUE IF NOT EXISTS 'HOLD_RELEASE';

CREATE TABLE "payroll_salary_holds" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "cycle_start" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "held_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_salary_holds_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_salary_holds_employee_id_cycle_start_key" ON "payroll_salary_holds"("employee_id", "cycle_start");
ALTER TABLE "payroll_salary_holds" ADD CONSTRAINT "payroll_salary_holds_reason_check" CHECK (length(btrim("reason")) >= 3);

CREATE TABLE "payroll_salary_releases" (
    "id" TEXT NOT NULL,
    "hold_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "released_by_user_id" TEXT NOT NULL,
    "adjustment_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_salary_releases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_salary_releases_hold_id_key" ON "payroll_salary_releases"("hold_id");
ALTER TABLE "payroll_salary_releases" ADD CONSTRAINT "payroll_salary_releases_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "payroll_salary_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_salary_releases" ADD CONSTRAINT "payroll_salary_releases_note_check" CHECK (length(btrim("note")) >= 3);

CREATE OR REPLACE FUNCTION payroll_salary_holds_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'SALARY_HOLDS_APPEND_ONLY: a hold or a release is never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_salary_holds_append_only BEFORE UPDATE OR DELETE ON "payroll_salary_holds" FOR EACH ROW EXECUTE FUNCTION payroll_salary_holds_append_only();
CREATE TRIGGER payroll_salary_holds_no_truncate BEFORE TRUNCATE ON "payroll_salary_holds" FOR EACH STATEMENT EXECUTE FUNCTION payroll_salary_holds_append_only();
CREATE TRIGGER payroll_salary_releases_append_only BEFORE UPDATE OR DELETE ON "payroll_salary_releases" FOR EACH ROW EXECUTE FUNCTION payroll_salary_holds_append_only();
CREATE TRIGGER payroll_salary_releases_no_truncate BEFORE TRUNCATE ON "payroll_salary_releases" FOR EACH STATEMENT EXECUTE FUNCTION payroll_salary_holds_append_only();

-- Only a Super Admin holds or releases salary (the service checks it too; this holds whatever the code does).
CREATE OR REPLACE FUNCTION payroll_salary_holds_director_only() RETURNS trigger AS $$
DECLARE actor TEXT;
BEGIN
  IF TG_TABLE_NAME = 'payroll_salary_holds' THEN actor := NEW."held_by_user_id"; ELSE actor := NEW."released_by_user_id"; END IF;
  IF NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = actor AND r."code" = 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'SALARY_HOLDS_DIRECTORS_ONLY: only a Super Admin holds or releases salary';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_salary_holds_director_only BEFORE INSERT ON "payroll_salary_holds" FOR EACH ROW EXECUTE FUNCTION payroll_salary_holds_director_only();
CREATE TRIGGER payroll_salary_releases_director_only BEFORE INSERT ON "payroll_salary_releases" FOR EACH ROW EXECUTE FUNCTION payroll_salary_holds_director_only();
