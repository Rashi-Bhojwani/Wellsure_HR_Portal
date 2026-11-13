-- Peeps Stage 3: the nudge-tag director check read every table's column in one CASE, which PL/pgSQL plans as a whole (each table has only its own
-- column), so every insert failed. Replaced with one branch per table: the same rule, forward-only.
CREATE OR REPLACE FUNCTION peeps_nudge_tag_director_only() RETURNS trigger AS $$
DECLARE uid TEXT;
BEGIN
  IF TG_TABLE_NAME = 'nudge_tag_awards' THEN
    uid := NEW."giver_user_id";
  ELSIF TG_TABLE_NAME = 'nudge_tag_removals' THEN
    uid := NEW."removed_by_user_id";
  ELSE
    uid := NEW."decided_by_user_id";
  END IF;
  IF NOT peeps_is_director(uid) THEN
    RAISE EXCEPTION 'PEEPS_NUDGE_DIRECTORS_ONLY: only a director gives, removes or decides a nudge tag';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
