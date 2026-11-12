-- PEEPS stage 2: document autofill (private uploads, one encrypted extraction result per document, per-field reviews, settings).
-- CreateTable
CREATE TABLE "autofill_setting_versions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB,
    "reason" TEXT NOT NULL,
    "changed_by_user_id" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autofill_setting_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autofill_documents" (
    "id" TEXT NOT NULL,
    "subject_kind" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "doc_kind" TEXT NOT NULL,
    "storage_key" TEXT,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "retention_until" TIMESTAMPTZ(3) NOT NULL,
    "purged_at" TIMESTAMPTZ(3),
    "applied_at" TIMESTAMPTZ(3),
    "applied_by_user_id" TEXT,
    "applied_via" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autofill_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autofill_extractions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL,
    "provider_version" TEXT NOT NULL,
    "engine" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT,
    "result_encrypted" BYTEA,
    "failure_code" TEXT,
    "duration_ms" INTEGER,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autofill_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autofill_field_reviews" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "value_encrypted" BYTEA,
    "reviewer_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autofill_field_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autofill_setting_versions_key_version_key" ON "autofill_setting_versions"("key", "version");

-- CreateIndex
CREATE INDEX "autofill_documents_subject_kind_subject_id_idx" ON "autofill_documents"("subject_kind", "subject_id");

-- CreateIndex
CREATE INDEX "autofill_documents_retention_until_purged_at_idx" ON "autofill_documents"("retention_until", "purged_at");

-- CreateIndex
CREATE UNIQUE INDEX "autofill_extractions_document_id_key" ON "autofill_extractions"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "autofill_field_reviews_document_id_field_key" ON "autofill_field_reviews"("document_id", "field");

-- AddForeignKey
ALTER TABLE "autofill_extractions" ADD CONSTRAINT "autofill_extractions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "autofill_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autofill_field_reviews" ADD CONSTRAINT "autofill_field_reviews_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "autofill_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE autofill_documents ADD CONSTRAINT autofill_document_kind CHECK (subject_kind IN ('CANDIDATE','EMPLOYEE') AND doc_kind IN ('RESUME','IDENTITY','BANK') AND ((doc_kind = 'RESUME') = (subject_kind = 'CANDIDATE')));
ALTER TABLE autofill_extractions ADD CONSTRAINT autofill_extraction_status CHECK (status IN ('QUEUED','RUNNING','DONE','FAILED'));
ALTER TABLE autofill_field_reviews ADD CONSTRAINT autofill_review_decision CHECK (decision IN ('ACCEPTED','CORRECTED','REJECTED') AND (decision <> 'REJECTED' OR value_encrypted IS NULL));

-- Settings: a director writes them; append-only.
CREATE FUNCTION peeps_autofill_director() RETURNS trigger AS $$ BEGIN
 IF NOT peeps_is_director(NEW.changed_by_user_id) THEN RAISE EXCEPTION 'AUTOFILL_DIRECTOR_ONLY'; END IF;
 RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER autofill_settings_director BEFORE INSERT ON autofill_setting_versions FOR EACH ROW EXECUTE FUNCTION peeps_autofill_director();
CREATE TRIGGER autofill_settings_immutable BEFORE UPDATE OR DELETE ON autofill_setting_versions FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only();
CREATE TRIGGER autofill_settings_no_truncate BEFORE TRUNCATE ON autofill_setting_versions FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only();

-- Documents, extractions and reviews are never deleted by the app (retention clears values instead); a review cannot change after
-- its document's values were saved.
CREATE FUNCTION peeps_autofill_no_delete() RETURNS trigger AS $$ BEGIN
 IF current_setting('app.audit_purge', true) = 'test' AND EXISTS (SELECT 1 FROM dev_database_marker) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'AUTOFILL_NO_DELETE: % rows are kept; retention clears their values', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['autofill_documents','autofill_extractions','autofill_field_reviews'] LOOP
 EXECUTE format('CREATE TRIGGER autofill_no_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION peeps_autofill_no_delete()', t);
 END LOOP; END; $$;
CREATE FUNCTION peeps_autofill_review_guard() RETURNS trigger AS $$ BEGIN
 IF NEW.decision = OLD.decision AND NEW.reviewer_user_id = OLD.reviewer_user_id AND NEW.field = OLD.field AND NEW.document_id = OLD.document_id THEN RETURN NEW; END IF; -- retention clearing or key rotation
 IF EXISTS (SELECT 1 FROM autofill_documents d WHERE d.id = OLD.document_id AND d.applied_at IS NOT NULL) THEN RAISE EXCEPTION 'AUTOFILL_REVIEW_SAVED'; END IF;
 RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER autofill_review_guard BEFORE UPDATE ON autofill_field_reviews FOR EACH ROW EXECUTE FUNCTION peeps_autofill_review_guard();
