-- P7-0 (docs/plans/PHASE_7.md §0A): employees' ESI numbers are encrypted like UANs, and the company's PAN and TAN live only as
-- sealed payroll identifiers (rules COMPANY_PAN and TAN), never as plain columns.
--
-- SQL cannot encrypt with the application's keys, so plain values are never converted here. A database the development seed
-- built (it carries the dev_database_marker row) holds made-up values only, and they are dropped with the columns: re-enter
-- them through the screens if wanted. Any other database that holds a value stops here, before anything changes, so a real
-- number is never silently lost; enter each one through the employee profile or Payroll -> Rules and Setup first, then clear
-- the old column, then migrate again.
DO $$
DECLARE
  plain_esi bigint;
  plain_company bigint;
BEGIN
  SELECT count(*) INTO plain_esi FROM employee_statutory WHERE esi_number IS NOT NULL AND btrim(esi_number) <> '';
  SELECT count(*) INTO plain_company FROM company WHERE (pan IS NOT NULL AND btrim(pan) <> '') OR (tan IS NOT NULL AND btrim(tan) <> '');
  IF (plain_esi > 0 OR plain_company > 0) AND NOT EXISTS (SELECT 1 FROM dev_database_marker) THEN
    RAISE EXCEPTION 'P7-0 refuses to drop plain identifiers from a database that is not a development one: % employee ESI number(s) and % company PAN/TAN value(s) are stored in the clear. Re-enter them through the employee profile (ESI) and Payroll > Rules and Setup (COMPANY_PAN, TAN), clear the old columns, then migrate again.', plain_esi, plain_company;
  END IF;
END $$;

ALTER TABLE "employee_statutory" DROP COLUMN "esi_number";
ALTER TABLE "employee_statutory" ADD COLUMN "esi_encrypted" BYTEA;
ALTER TABLE "employee_statutory" ADD COLUMN "esi_last4" TEXT;

ALTER TABLE "company" DROP COLUMN "pan";
ALTER TABLE "company" DROP COLUMN "tan";
