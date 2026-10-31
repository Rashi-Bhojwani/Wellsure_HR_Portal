-- Decision D-31: whether a monthly figure may be negative is a director's choice per pay head (Not set until chosen), no longer a fixed rule.
-- The service enforces the choice (the database does not know about pay heads); the row still holds either a clear with no amount, or an entered amount.
ALTER TABLE "payroll_monthly_inputs" DROP CONSTRAINT "payroll_monthly_inputs_amount_check";
ALTER TABLE "payroll_monthly_inputs" ADD CONSTRAINT "payroll_monthly_inputs_amount_check" CHECK ((cleared AND amount IS NULL) OR (NOT cleared AND amount IS NOT NULL));
