-- CreateTable
CREATE TABLE "recruitment_setting_versions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "changed_by_user_id" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_setting_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changed_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_requisitions" (
    "id" TEXT NOT NULL,
    "requester_employee_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "employment_type" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approval_route" JSONB,
    "approval_by_user_id" TEXT,
    "decision_reason" TEXT,
    "changed_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "requisition_id" TEXT,
    "title" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "employment_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pipeline_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "changed_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" TEXT NOT NULL,
    "name_encrypted" BYTEA,
    "email_encrypted" BYTEA,
    "phone_encrypted" BYTEA,
    "name_hash" TEXT,
    "email_hash" TEXT,
    "phone_hash" TEXT,
    "source" TEXT NOT NULL,
    "consent_recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "retention_until" TIMESTAMPTZ(3) NOT NULL,
    "retention_version_id" TEXT NOT NULL,
    "cv_storage_key" TEXT,
    "cv_mime_type" TEXT,
    "anonymized_at" TIMESTAMPTZ(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "reason_category" TEXT,
    "changed_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_stage_moves" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "from_stage_id" TEXT,
    "to_stage_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT,
    "actor_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_stage_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_interviews" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "round" TEXT NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "scorecard" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "changed_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_interview_panel" (
    "id" TEXT NOT NULL,
    "interview_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "assigned_by_user_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_interview_panel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_feedback" (
    "id" TEXT NOT NULL,
    "interview_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "answers_encrypted" BYTEA,
    "recommendation_encrypted" BYTEA,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_history" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "actor_user_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_candidate_mail" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "interview_id" TEXT,
    "template_id" TEXT NOT NULL,
    "template_version_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "sent_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_candidate_mail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_setting_versions_key_version_key" ON "recruitment_setting_versions"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_version_key" ON "pipelines"("version");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_pipeline_id_code_key" ON "pipeline_stages"("pipeline_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_pipeline_id_position_key" ON "pipeline_stages"("pipeline_id", "position");

-- CreateIndex
CREATE INDEX "job_requisitions_requester_employee_id_status_idx" ON "job_requisitions"("requester_employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_requisition_id_key" ON "jobs"("requisition_id");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_email_hash_key" ON "candidates"("email_hash");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_phone_hash_key" ON "candidates"("phone_hash");

-- CreateIndex
CREATE INDEX "candidates_retention_until_anonymized_at_idx" ON "candidates"("retention_until", "anonymized_at");

-- CreateIndex
CREATE UNIQUE INDEX "applications_candidate_id_job_id_key" ON "applications"("candidate_id", "job_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_stage_moves_application_id_version_key" ON "application_stage_moves"("application_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_interview_panel_interview_id_employee_id_key" ON "recruitment_interview_panel"("interview_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "interview_feedback_interview_id_employee_id_key" ON "interview_feedback"("interview_id", "employee_id");

-- CreateIndex
CREATE INDEX "recruitment_history_entity_type_entity_id_idx" ON "recruitment_history"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_candidate_mail_idempotency_key_key" ON "recruitment_candidate_mail"("idempotency_key");

-- CreateIndex
CREATE INDEX "recruitment_candidate_mail_candidate_id_idx" ON "recruitment_candidate_mail"("candidate_id");

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_requester_employee_id_fkey" FOREIGN KEY ("requester_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "job_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_stage_moves" ADD CONSTRAINT "application_stage_moves_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_interviews" ADD CONSTRAINT "recruitment_interviews_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_interview_panel" ADD CONSTRAINT "recruitment_interview_panel_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "recruitment_interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_interview_panel" ADD CONSTRAINT "recruitment_interview_panel_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "recruitment_interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_candidate_mail" ADD CONSTRAINT "recruitment_candidate_mail_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- PEEPS: additive capability; all existing choices retained.
ALTER TABLE hr_capability_switches DROP CONSTRAINT hr_capability_switches_capability_check;
ALTER TABLE hr_capability_switches ADD CONSTRAINT hr_capability_switches_capability_check CHECK (capability IN ('VIEW_ATTENDANCE','APPROVE_REGULARIZATIONS','APPROVE_LEAVE','EDIT_MUSTER','UPLOAD_MANUAL_MUSTER','FINALISE_MONTH','CORRECTIONS','SHIFT_ROSTER','EXCEPTIONS_QUEUE','ATTENDANCE_REPORTS','LEAVE_REPORTS','SEE_LEAVE_COUNTS','SEND_INVITATIONS','IMPORT_EMPLOYEE_DETAILS','ISSUE_LETTERS_NO_PAY','MANAGE_EXITS','MANAGE_RECRUITMENT'));
ALTER TABLE job_requisitions ADD CONSTRAINT recruitment_requisition_status CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED','CLOSED') AND headcount>0);
ALTER TABLE jobs ADD CONSTRAINT recruitment_job_status CHECK (status IN ('DRAFT','OPEN','ON_HOLD','CLOSED') AND (status<>'OPEN' OR pipeline_id IS NOT NULL));
ALTER TABLE applications ADD CONSTRAINT recruitment_application_status CHECK (status IN ('ACTIVE','HIRED','REJECTED','WITHDRAWN'));
ALTER TABLE candidates ADD CONSTRAINT recruitment_candidate_retention CHECK (retention_until>=consent_recorded_at AND (anonymized_at IS NULL OR (name_encrypted IS NULL AND email_encrypted IS NULL AND phone_encrypted IS NULL AND name_hash IS NULL AND email_hash IS NULL AND phone_hash IS NULL AND cv_storage_key IS NULL)));
CREATE FUNCTION peeps_recruitment_director() RETURNS trigger AS $$ BEGIN
 IF NOT peeps_is_director(NEW.changed_by_user_id) THEN RAISE EXCEPTION 'RECRUITMENT_DIRECTOR_ONLY'; END IF;
 RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER recruitment_settings_director BEFORE INSERT ON recruitment_setting_versions FOR EACH ROW EXECUTE FUNCTION peeps_recruitment_director();
CREATE TRIGGER recruitment_pipeline_director BEFORE INSERT ON pipelines FOR EACH ROW EXECUTE FUNCTION peeps_recruitment_director();
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['recruitment_setting_versions','pipelines','pipeline_stages','application_stage_moves','recruitment_history'] LOOP
 EXECUTE format('CREATE TRIGGER recruitment_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only()',t);
 EXECUTE format('CREATE TRIGGER recruitment_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only()',t);
 END LOOP; END; $$;
CREATE FUNCTION peeps_recruitment_feedback_guard() RETURNS trigger AS $$ BEGIN
 IF current_setting('app.audit_purge',true)='test' AND EXISTS(SELECT 1 FROM dev_database_marker) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='UPDATE' AND NEW.answers_encrypted IS NULL AND NEW.recommendation_encrypted IS NULL AND (to_jsonb(NEW)-'answers_encrypted'-'recommendation_encrypted')=(to_jsonb(OLD)-'answers_encrypted'-'recommendation_encrypted') AND EXISTS(SELECT 1 FROM recruitment_interviews i JOIN applications a ON a.id=i.application_id JOIN candidates c ON c.id=a.candidate_id WHERE i.id=OLD.interview_id AND (c.anonymized_at IS NOT NULL OR c.retention_until<=now())) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'RECRUITMENT_FEEDBACK_IMMUTABLE'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER recruitment_feedback_immutable BEFORE UPDATE OR DELETE ON interview_feedback FOR EACH ROW EXECUTE FUNCTION peeps_recruitment_feedback_guard();
CREATE TRIGGER recruitment_feedback_no_truncate BEFORE TRUNCATE ON interview_feedback FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only();
CREATE FUNCTION peeps_recruitment_status_history() RETURNS trigger AS $$ BEGIN
 IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
 INSERT INTO recruitment_history(id,entity_type,entity_id,event,from_status,to_status,actor_user_id) VALUES(gen_random_uuid()::text,TG_TABLE_NAME,NEW.id,'STATUS_CHANGED',CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,NEW.status,NEW.changed_by_user_id);
 END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER recruitment_req_history AFTER INSERT OR UPDATE OF status ON job_requisitions FOR EACH ROW EXECUTE FUNCTION peeps_recruitment_status_history();
CREATE TRIGGER recruitment_job_history AFTER INSERT OR UPDATE OF status ON jobs FOR EACH ROW EXECUTE FUNCTION peeps_recruitment_status_history();
CREATE TRIGGER recruitment_application_history AFTER INSERT OR UPDATE OF status ON applications FOR EACH ROW EXECUTE FUNCTION peeps_recruitment_status_history();
CREATE TRIGGER recruitment_interview_history AFTER INSERT OR UPDATE OF status ON recruitment_interviews FOR EACH ROW EXECUTE FUNCTION peeps_recruitment_status_history();
