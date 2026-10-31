-- Stage 5b, B6: a person marked as not on payroll for a period. Append-only and effective-dated (ending one early is another row); it takes effect only when a DIFFERENT director confirms it.
CREATE TYPE "PayrollExclusionKind" AS ENUM ('EXCLUDE', 'INCLUDE');

CREATE TABLE "payroll_exclusions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "kind" "PayrollExclusionKind" NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE,
    "reason" TEXT NOT NULL,
    "made_by_user_id" TEXT NOT NULL,
    "confirmed_by_user_id" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_exclusions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_exclusions_employee_id_from_date_idx" ON "payroll_exclusions"("employee_id", "from_date");
ALTER TABLE "payroll_exclusions" ADD CONSTRAINT "payroll_exclusions_reason_check" CHECK (length(btrim("reason")) >= 3);
ALTER TABLE "payroll_exclusions" ADD CONSTRAINT "payroll_exclusions_dates_check" CHECK ("to_date" IS NULL OR "to_date" >= "from_date");
ALTER TABLE "payroll_exclusions" ADD CONSTRAINT "payroll_exclusions_confirm_pair_check" CHECK (("confirmed_by_user_id" IS NULL) = ("confirmed_at" IS NULL));

CREATE OR REPLACE FUNCTION payroll_exclusions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'PAYROLL_EXCLUSION_APPEND_ONLY: a payroll exclusion is never deleted; end it with a later entry';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."confirmed_by_user_id" IS NOT NULL THEN RAISE EXCEPTION 'PAYROLL_EXCLUSION_UNCONFIRMED: an entry starts unconfirmed'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."made_by_user_id" AND r."code" = 'SUPER_ADMIN') THEN
      RAISE EXCEPTION 'PAYROLL_EXCLUSION_DIRECTORS_ONLY: only a Super Admin marks somebody as not on payroll';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: the only change allowed is the one confirmation, by a different Super Admin.
  IF OLD."confirmed_by_user_id" IS NOT NULL THEN RAISE EXCEPTION 'PAYROLL_EXCLUSION_APPEND_ONLY: a confirmed entry never changes'; END IF;
  IF NEW."employee_id" <> OLD."employee_id" OR NEW."kind" <> OLD."kind" OR NEW."from_date" <> OLD."from_date" OR NEW."to_date" IS DISTINCT FROM OLD."to_date" OR NEW."reason" <> OLD."reason" OR NEW."made_by_user_id" <> OLD."made_by_user_id" THEN
    RAISE EXCEPTION 'PAYROLL_EXCLUSION_APPEND_ONLY: only the confirmation can be written';
  END IF;
  IF NEW."confirmed_by_user_id" IS NULL THEN RAISE EXCEPTION 'PAYROLL_EXCLUSION_APPEND_ONLY: nothing to write'; END IF;
  IF NEW."confirmed_by_user_id" = OLD."made_by_user_id" THEN RAISE EXCEPTION 'PAYROLL_EXCLUSION_SELF_CONFIRM: a different director has to confirm it'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."confirmed_by_user_id" AND r."code" = 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'PAYROLL_EXCLUSION_DIRECTORS_ONLY: only a Super Admin confirms it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_exclusions_guard BEFORE INSERT OR UPDATE OR DELETE ON "payroll_exclusions" FOR EACH ROW EXECUTE FUNCTION payroll_exclusions_guard();
