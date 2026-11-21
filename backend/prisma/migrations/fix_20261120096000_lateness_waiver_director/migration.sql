-- FIX-M8 (independent audit 2026-11-20): a lateness waiver cancels a pay cut, so with the director setting "lateness.waiverNeedsDirector" on (the default) HR's
-- approval is HR_APPROVED and a director confirms it before it takes effect.
ALTER TABLE "late_waivers" ADD COLUMN "hr_approved_by_user_id" TEXT;
ALTER TABLE "late_waivers" ADD COLUMN "hr_approved_at" TIMESTAMPTZ(3);
ALTER TABLE "late_waivers" DROP CONSTRAINT "late_waivers_status";
ALTER TABLE "late_waivers" ADD CONSTRAINT "late_waivers_status" CHECK ("status" IN ('PENDING', 'HR_APPROVED', 'APPROVED', 'REJECTED', 'WITHDRAWN'));
-- A director confirming is never the HR person who approved it.
ALTER TABLE "late_waivers" ADD CONSTRAINT "late_waivers_confirmer_not_hr_approver" CHECK ("hr_approved_by_user_id" IS NULL OR "status" <> 'APPROVED' OR "decided_by_user_id" <> "hr_approved_by_user_id");
-- HR_APPROVED is undecided (no decider yet) but records its HR approver; it is still the one open request for that day.
ALTER TABLE "late_waivers" DROP CONSTRAINT "late_waivers_decided";
ALTER TABLE "late_waivers" ADD CONSTRAINT "late_waivers_decided" CHECK (("status" IN ('PENDING', 'WITHDRAWN', 'HR_APPROVED')) = ("decided_by_user_id" IS NULL));
ALTER TABLE "late_waivers" ADD CONSTRAINT "late_waivers_hr_approved" CHECK ("status" <> 'HR_APPROVED' OR "hr_approved_by_user_id" IS NOT NULL);
DROP INDEX "late_waivers_one_open";
CREATE UNIQUE INDEX "late_waivers_one_open" ON "late_waivers"("employee_id", "date") WHERE "status" IN ('PENDING', 'HR_APPROVED', 'APPROVED');
-- A decided waiver is never changed; an HR-approved one may only be decided (by a director) or withdrawn.
CREATE OR REPLACE FUNCTION late_waiver_decided_fixed() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PENDING' THEN RETURN NEW; END IF;
  IF OLD."status" = 'HR_APPROVED' AND NEW."status" IN ('APPROVED', 'REJECTED', 'WITHDRAWN') AND NEW."hr_approved_by_user_id" IS NOT DISTINCT FROM OLD."hr_approved_by_user_id" THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'LATE_WAIVER_DECIDED: a decided lateness waiver is never changed';
END;
$$ LANGUAGE plpgsql;
