-- PEEPS stage 2 carry-overs (forward-only, additive).
-- 1.1 Default hiring stages as pipeline version 0 (Default, change in settings): a director confirms new versions as before.
-- 1.2 Ledger of joining documents copied into employee documents at conversion (once per joining document).

-- CreateTable
CREATE TABLE "recruitment_conversion_documents" (
    "id" TEXT NOT NULL,
    "joiner_document_id" TEXT NOT NULL,
    "employee_document_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_conversion_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_conversion_documents_joiner_document_id_key" ON "recruitment_conversion_documents"("joiner_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_conversion_documents_employee_document_id_key" ON "recruitment_conversion_documents"("employee_document_id");

-- CreateIndex
CREATE INDEX "recruitment_conversion_documents_employee_id_idx" ON "recruitment_conversion_documents"("employee_id");

-- AddForeignKey
ALTER TABLE "recruitment_conversion_documents" ADD CONSTRAINT "recruitment_conversion_documents_joiner_document_id_fkey" FOREIGN KEY ("joiner_document_id") REFERENCES "recruitment_joiner_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['recruitment_conversion_documents'] LOOP
 EXECUTE format('CREATE TRIGGER recruitment_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only()',t);
 EXECUTE format('CREATE TRIGGER recruitment_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only()',t);
 END LOOP; END; $$;

-- The default pipeline is written by this migration, not by a director, so the director-only insert trigger is paused for this one
-- statement and restored at once. Only when no version 0 exists (idempotent; existing director versions are untouched).
ALTER TABLE pipelines DISABLE TRIGGER recruitment_pipeline_director;
INSERT INTO pipelines (id, name, version, changed_by_user_id)
SELECT 'peeps-default-pipeline', 'Default hiring stages', 0, 'SYSTEM_DEFAULT'
WHERE NOT EXISTS (SELECT 1 FROM pipelines WHERE version = 0);
ALTER TABLE pipelines ENABLE TRIGGER recruitment_pipeline_director;
INSERT INTO pipeline_stages (id, pipeline_id, code, label, position)
SELECT 'peeps-default-stage-' || s.code, 'peeps-default-pipeline', s.code, s.label, s.position
FROM (VALUES ('SCREENING', 'Screening', 0), ('INTERVIEW', 'Interview', 1), ('OFFER', 'Offer', 2), ('HIRED', 'Hired', 3), ('NOT_MOVING_FORWARD', 'Not moving forward', 4)) AS s(code, label, position)
WHERE EXISTS (SELECT 1 FROM pipelines WHERE id = 'peeps-default-pipeline')
  AND NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE pipeline_id = 'peeps-default-pipeline');
