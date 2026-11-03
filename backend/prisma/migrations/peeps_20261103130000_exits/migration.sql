-- Peeps exits only. No business settings are preloaded.

CREATE TABLE "exit_setting_versions" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "value" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "changed_by_user_id" TEXT NOT NULL,
  "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exit_setting_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exit_setting_versions_key_version_key" ON "exit_setting_versions"("key", "version");

CREATE TABLE "resignations" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "requested_last_day" DATE NOT NULL,
  "reason_category" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at" TIMESTAMPTZ(3),
  "accepted_by_user_id" TEXT,
  "approval_by_user_id" TEXT,
  "approval_last_day" DATE,
  "notice_rule" JSONB,
  "notice_rule_version_id" TEXT,
  "decision_note" TEXT,
  "changed_by_user_id" TEXT,
  CONSTRAINT "resignations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "resignations_employee_id_idempotency_key_key" ON "resignations"("employee_id", "idempotency_key");

CREATE INDEX "resignations_employee_id_status_idx" ON "resignations"("employee_id", "status");

CREATE TABLE "exit_cases" (
  "id" TEXT NOT NULL,
  "resignation_id" TEXT NOT NULL,
  "separation_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "template_id" TEXT,
  "observed_last_day" DATE NOT NULL,
  "override_reason" TEXT,
  "override_by_user_id" TEXT,
  "override_at" TIMESTAMPTZ(3),
  "override_fingerprint" TEXT,
  "closed_at" TIMESTAMPTZ(3),
  "close_note" TEXT,
  "closure_source" TEXT,
  "changed_by_user_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exit_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exit_cases_resignation_id_key" ON "exit_cases"("resignation_id");

CREATE UNIQUE INDEX "exit_cases_separation_id_key" ON "exit_cases"("separation_id");

CREATE INDEX "exit_cases_status_idx" ON "exit_cases"("status");

CREATE TABLE "exit_checklist_templates" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "asset_owner" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "changed_by_user_id" TEXT NOT NULL,
  "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exit_checklist_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exit_checklist_templates_version_key" ON "exit_checklist_templates"("version");

CREATE TABLE "exit_checklist_items" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "owner_team" TEXT NOT NULL,
  "owner_employee_ids" TEXT[] NOT NULL,
  "required" BOOLEAN NOT NULL,
  "asset_assignment_id" TEXT,
  "done_at" TIMESTAMPTZ(3),
  "done_by_user_id" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exit_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exit_checklist_items_case_id_code_key" ON "exit_checklist_items"("case_id", "code");

CREATE INDEX "exit_checklist_items_case_id_idx" ON "exit_checklist_items"("case_id");

CREATE TABLE "exit_interviews" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "interviewer_employee_id" TEXT NOT NULL,
  "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
  "questions" JSONB NOT NULL,
  "questions_version_id" TEXT NOT NULL,
  "answers_encrypted" BYTEA,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "answered_at" TIMESTAMPTZ(3),
  "purge_after" TIMESTAMPTZ(3),
  "retention_version_id" TEXT,
  "changed_by_user_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exit_interviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exit_interviews_case_id_key" ON "exit_interviews"("case_id");

CREATE INDEX "exit_interviews_interviewer_employee_id_status_idx" ON "exit_interviews"("interviewer_employee_id", "status");

CREATE TABLE "exit_history" (
  "id" TEXT NOT NULL,
  "resignation_id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT,
  "confidential" BOOLEAN NOT NULL DEFAULT false,
  "actor_user_id" TEXT,
  "detail" JSONB,
  "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exit_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "exit_history_resignation_id_at_idx" ON "exit_history"("resignation_id", "at");

CREATE TABLE "exit_letter_requests" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "requested_by_user_id" TEXT NOT NULL,
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exit_letter_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exit_letter_requests_case_id_kind_key" ON "exit_letter_requests"("case_id", "kind");

ALTER TABLE "resignations" ADD CONSTRAINT "resignations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exit_cases" ADD CONSTRAINT "exit_cases_resignation_id_fkey" FOREIGN KEY ("resignation_id") REFERENCES "resignations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exit_cases" ADD CONSTRAINT "exit_cases_separation_id_fkey" FOREIGN KEY ("separation_id") REFERENCES "separations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exit_checklist_items" ADD CONSTRAINT "exit_checklist_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "exit_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exit_interviews" ADD CONSTRAINT "exit_interviews_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "exit_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exit_interviews" ADD CONSTRAINT "exit_interviews_interviewer_employee_id_fkey" FOREIGN KEY ("interviewer_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exit_history" ADD CONSTRAINT "exit_history_resignation_id_fkey" FOREIGN KEY ("resignation_id") REFERENCES "resignations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exit_letter_requests" ADD CONSTRAINT "exit_letter_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "exit_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX resignations_one_active_per_employee ON resignations(employee_id) WHERE active;
ALTER TABLE resignations ADD CONSTRAINT peeps_resignation_status CHECK (status IN ('SUBMITTED','ACCEPTED','REJECTED','WITHDRAWN') AND (NOT active OR status IN ('SUBMITTED','ACCEPTED')));
ALTER TABLE exit_cases ADD CONSTRAINT peeps_exit_case_status CHECK (status IN ('OPEN','CLEARANCE','READY_FOR_SETTLEMENT','CLOSED'));
ALTER TABLE exit_interviews ADD CONSTRAINT peeps_exit_interview_status CHECK (status IN ('SCHEDULED','SUBMITTED','COMPLETED','PURGED'));
ALTER TABLE exit_checklist_items ADD CONSTRAINT peeps_exit_item_owner CHECK (owner_team IN ('IT','ADMIN','MANAGER','HR') AND ((done_at IS NULL AND done_by_user_id IS NULL) OR (done_at IS NOT NULL AND done_by_user_id IS NOT NULL)));
ALTER TABLE exit_letter_requests ADD CONSTRAINT peeps_exit_letter_kind CHECK (kind IN ('RELIEVING','EXPERIENCE'));
CREATE FUNCTION peeps_exit_setting_actor() RETURNS trigger AS $$
BEGIN
  IF NOT peeps_is_director(NEW.changed_by_user_id) THEN RAISE EXCEPTION 'EXITS_DIRECTOR_ONLY'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER peeps_exit_setting_director BEFORE INSERT ON exit_setting_versions FOR EACH ROW EXECUTE FUNCTION peeps_exit_setting_actor();
CREATE TRIGGER peeps_exit_template_director BEFORE INSERT ON exit_checklist_templates FOR EACH ROW EXECUTE FUNCTION peeps_exit_setting_actor();
CREATE TRIGGER peeps_exit_settings_immutable BEFORE UPDATE OR DELETE ON exit_setting_versions FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only();
CREATE TRIGGER peeps_exit_settings_no_truncate BEFORE TRUNCATE ON exit_setting_versions FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only();
CREATE TRIGGER peeps_exit_templates_immutable BEFORE UPDATE OR DELETE ON exit_checklist_templates FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only();
CREATE TRIGGER peeps_exit_templates_no_truncate BEFORE TRUNCATE ON exit_checklist_templates FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only();
CREATE TRIGGER peeps_exit_history_immutable BEFORE UPDATE OR DELETE ON exit_history FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only();
CREATE TRIGGER peeps_exit_history_no_truncate BEFORE TRUNCATE ON exit_history FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only();

-- Status history cannot be forgotten by a service call or a concurrent writer.
CREATE FUNCTION peeps_exit_status_history() RETURNS trigger AS $$
DECLARE rid TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'resignations' THEN rid := NEW.id;
  ELSIF TG_TABLE_NAME = 'exit_cases' THEN rid := NEW.resignation_id;
  ELSE SELECT resignation_id INTO rid FROM exit_cases WHERE id = NEW.case_id;
  END IF;
  INSERT INTO exit_history(id,resignation_id,entity_type,entity_id,event,from_status,to_status,confidential,actor_user_id)
  VALUES(gen_random_uuid()::text,rid,TG_TABLE_NAME,NEW.id,'STATUS_CHANGED',CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,NEW.status,TG_TABLE_NAME='exit_interviews',NEW.changed_by_user_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER peeps_resignation_history AFTER INSERT OR UPDATE OF status ON resignations FOR EACH ROW EXECUTE FUNCTION peeps_exit_status_history();
CREATE TRIGGER peeps_exit_case_history AFTER INSERT OR UPDATE OF status ON exit_cases FOR EACH ROW EXECUTE FUNCTION peeps_exit_status_history();
CREATE TRIGGER peeps_exit_interview_history AFTER INSERT OR UPDATE OF status ON exit_interviews FOR EACH ROW EXECUTE FUNCTION peeps_exit_status_history();
