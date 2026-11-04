-- One source for the gate, used by the service and the transition trigger.
CREATE FUNCTION peeps_exit_blockers(case_id text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
  'started', c.template_id IS NOT NULL,
  'requiredItemIds', COALESCE((SELECT jsonb_agg(i.id ORDER BY i.id) FROM exit_checklist_items i WHERE i.case_id=c.id AND i.required AND i.done_at IS NULL),'[]'::jsonb),
  'assignmentIds', COALESCE((SELECT jsonb_agg(a.id ORDER BY a.id) FROM asset_assignments a JOIN resignations r ON r.employee_id=a.employee_id WHERE r.id=c.resignation_id AND a.ended_at IS NULL),'[]'::jsonb))
 FROM exit_cases c WHERE c.id=case_id
$$;
CREATE FUNCTION peeps_exit_clearance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE blockers jsonb;
BEGIN
 IF NEW.status IN ('READY_FOR_SETTLEMENT','CLOSED') AND NEW.closure_source IS DISTINCT FROM 'CANCELLED_SEPARATION' THEN
  blockers := peeps_exit_blockers(NEW.id);
  IF NOT (blockers->>'started')::boolean OR jsonb_array_length(blockers->'requiredItemIds')>0 OR jsonb_array_length(blockers->'assignmentIds')>0 THEN
   IF NOT COALESCE((COALESCE(peeps_is_director(NEW.override_by_user_id),false) AND length(btrim(COALESCE(NEW.override_reason,'')))>0 AND NEW.override_fingerprint::jsonb=blockers),false) THEN
    RAISE EXCEPTION 'EXIT_CLEARANCE_BLOCKED: required items or assigned assets remain open';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER exit_clearance_guard BEFORE UPDATE OF status ON exit_cases FOR EACH ROW EXECUTE FUNCTION peeps_exit_clearance_guard();

-- Serialize a new issue with a ready transition. A later asset always reopens
-- clearance, including a previous override; it cannot inherit an old waiver.
CREATE FUNCTION peeps_exit_assignment_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.ended_at IS NULL THEN
  UPDATE exit_cases c SET status=CASE WHEN c.status='READY_FOR_SETTLEMENT' THEN 'CLEARANCE' ELSE c.status END,
    override_reason=NULL,override_by_user_id=NULL,override_at=NULL,override_fingerprint=NULL,changed_by_user_id=NULL
  FROM resignations r WHERE c.resignation_id=r.id AND r.employee_id=NEW.employee_id AND c.status<>'CLOSED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER peeps_exit_assignment_changed AFTER INSERT OR UPDATE OF ended_at ON asset_assignments FOR EACH ROW EXECUTE FUNCTION peeps_exit_assignment_changed();
