-- Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md item 3): the year end honours the leave policy's carry-forward cap and year-end encashment, and refuses while
-- either is Not set. Existing values are kept as they are: year_end_encashment keeps every row's value (only its default and NOT NULL go), and the new
-- carry_forward_rule starts Not set everywhere (a director chooses CAPPED with the cap, or UNLIMITED).
ALTER TABLE "leave_policies" ADD COLUMN "carry_forward_rule" TEXT;
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_carry_forward_rule_check" CHECK ("carry_forward_rule" IS NULL OR "carry_forward_rule" IN ('CAPPED', 'UNLIMITED'));
ALTER TABLE "leave_policies" ALTER COLUMN "year_end_encashment" DROP NOT NULL;
ALTER TABLE "leave_policies" ALTER COLUMN "year_end_encashment" DROP DEFAULT;

ALTER TABLE "year_end_run_items" ADD COLUMN "carried_forward_days" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "year_end_run_items" ADD COLUMN "lapsed_days" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "year_end_run_items" ADD COLUMN "ledger_lapse_entry_id" TEXT;
CREATE UNIQUE INDEX "year_end_run_items_ledger_lapse_entry_id_key" ON "year_end_run_items"("ledger_lapse_entry_id");
