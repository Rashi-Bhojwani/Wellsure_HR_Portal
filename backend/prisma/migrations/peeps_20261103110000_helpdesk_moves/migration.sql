ALTER TABLE helpdesk_messages ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE helpdesk_category_moves (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES helpdesk_tickets(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  source_category_id TEXT NOT NULL REFERENCES helpdesk_categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  target_category_id TEXT NOT NULL REFERENCES helpdesk_categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  source_category_code TEXT NOT NULL,
  target_category_code TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT peeps_move_no_payroll CHECK (source_category_code <> 'PAYROLL_SALARY' AND target_category_code <> 'PAYROLL_SALARY'),
  CONSTRAINT peeps_move_reason CHECK (length(btrim(reason)) > 0 AND source_category_id <> target_category_id)
);
CREATE UNIQUE INDEX helpdesk_category_moves_actor_user_id_idempotency_key_key ON helpdesk_category_moves(actor_user_id, idempotency_key);
CREATE FUNCTION peeps_helpdesk_move_category() RETURNS trigger AS $$
BEGIN
  SELECT code INTO NEW.source_category_code FROM helpdesk_categories WHERE id = NEW.source_category_id;
  SELECT code INTO NEW.target_category_code FROM helpdesk_categories WHERE id = NEW.target_category_id;
  IF NOT EXISTS (SELECT 1 FROM helpdesk_tickets WHERE id = NEW.ticket_id AND category_id = NEW.source_category_id) THEN
    RAISE EXCEPTION 'HELPDESK_MOVE_SOURCE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER peeps_move_category BEFORE INSERT ON helpdesk_category_moves FOR EACH ROW EXECUTE FUNCTION peeps_helpdesk_move_category();
CREATE TRIGGER peeps_move_append_only BEFORE UPDATE OR DELETE ON helpdesk_category_moves FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only();
CREATE TRIGGER peeps_move_no_truncate BEFORE TRUNCATE ON helpdesk_category_moves FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only();
CREATE OR REPLACE FUNCTION peeps_helpdesk_protect_payroll_code() RETURNS trigger AS $$
BEGIN
  IF NEW.code = 'PAYROLL_SALARY' AND NEW.code IS DISTINCT FROM OLD.code AND (
    EXISTS (SELECT 1 FROM helpdesk_category_visibility WHERE category_id = OLD.id)
    OR EXISTS (SELECT 1 FROM helpdesk_category_visibility_history WHERE category_id = OLD.id)
    OR EXISTS (SELECT 1 FROM helpdesk_category_moves WHERE source_category_id = OLD.id OR target_category_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'HELPDESK_VISIBILITY_PAYROLL_EXCLUDED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
