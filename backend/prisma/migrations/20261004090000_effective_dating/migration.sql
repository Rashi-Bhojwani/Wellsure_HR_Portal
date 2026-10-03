-- Effective dating (EF1, docs/plans/EFFECTIVE_DATES.md): the database
-- enforces the one model — a row covers its start up to but not including
-- its end, rows never run backwards, and no two rows for one employee (or
-- one device ID) cover the same day.
--
-- This migration CHANGES NO DATA. If existing rows break the rules it stops
-- here, before any change, and says so; `npm run history:repair` lists
-- every such row (user decision 2026-10-03: history is never rewritten
-- without a person approving the exact list first).

DO $$
DECLARE bad integer;
BEGIN
  SELECT
    (SELECT count(*) FROM employee_job_history WHERE effective_to IS NOT NULL AND effective_to <= effective_from) +
    (SELECT count(*) FROM employee_name_history WHERE effective_to IS NOT NULL AND effective_to <= effective_from) +
    (SELECT count(*) FROM employee_bank_accounts WHERE effective_to IS NOT NULL AND effective_to <= effective_from) +
    (SELECT count(*) FROM device_user_mappings WHERE valid_to IS NOT NULL AND valid_to <= valid_from) +
    (SELECT count(*) FROM employee_job_history a JOIN employee_job_history b ON a.employee_id = b.employee_id AND a.id < b.id
       WHERE daterange(a.effective_from, a.effective_to, '[)') && daterange(b.effective_from, b.effective_to, '[)')) +
    (SELECT count(*) FROM employee_name_history a JOIN employee_name_history b ON a.employee_id = b.employee_id AND a.id < b.id
       WHERE daterange(a.effective_from, a.effective_to, '[)') && daterange(b.effective_from, b.effective_to, '[)')) +
    (SELECT count(*) FROM employee_bank_accounts a JOIN employee_bank_accounts b ON a.employee_id = b.employee_id AND a.id < b.id
       WHERE daterange(a.effective_from, a.effective_to, '[)') && daterange(b.effective_from, b.effective_to, '[)')) +
    (SELECT count(*) FROM device_user_mappings a JOIN device_user_mappings b ON a.id < b.id AND (a.employee_id = b.employee_id OR a.device_user_id = b.device_user_id)
       WHERE daterange(a.valid_from, a.valid_to, '[)') && daterange(b.valid_from, b.valid_to, '[)'))
  INTO bad;
  IF bad > 0 THEN
    RAISE EXCEPTION 'History has % inverted or overlapping row(s). Nothing was changed. Run `npm run history:repair` (from backend/) to see each one; they need a person to decide.', bad;
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE employee_job_history ADD CONSTRAINT employee_job_history_dates_ordered CHECK (effective_to IS NULL OR effective_to > effective_from);
ALTER TABLE employee_name_history ADD CONSTRAINT employee_name_history_dates_ordered CHECK (effective_to IS NULL OR effective_to > effective_from);
ALTER TABLE employee_bank_accounts ADD CONSTRAINT employee_bank_accounts_dates_ordered CHECK (effective_to IS NULL OR effective_to > effective_from);
ALTER TABLE device_user_mappings ADD CONSTRAINT device_user_mappings_dates_ordered CHECK (valid_to IS NULL OR valid_to > valid_from);

ALTER TABLE employee_job_history ADD CONSTRAINT employee_job_history_no_overlap
  EXCLUDE USING gist (employee_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&);
ALTER TABLE employee_name_history ADD CONSTRAINT employee_name_history_no_overlap
  EXCLUDE USING gist (employee_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&);
ALTER TABLE employee_bank_accounts ADD CONSTRAINT employee_bank_accounts_no_overlap
  EXCLUDE USING gist (employee_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&);
ALTER TABLE device_user_mappings ADD CONSTRAINT device_user_mappings_employee_no_overlap
  EXCLUDE USING gist (employee_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&);
-- One device ID is never two people on the same day.
ALTER TABLE device_user_mappings ADD CONSTRAINT device_user_mappings_device_no_overlap
  EXCLUDE USING gist (device_user_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&);
