-- PEEPS: mail receipts retain non-personal context only, never a recipient or rendered body.
ALTER TABLE recruitment_candidate_mail ADD COLUMN application_id TEXT;
