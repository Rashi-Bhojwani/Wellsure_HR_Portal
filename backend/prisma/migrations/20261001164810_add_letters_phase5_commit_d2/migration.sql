-- CreateEnum
CREATE TYPE "GeneratedLetterStatus" AS ENUM ('QUEUED', 'GENERATED', 'FAILED');

-- CreateTable
CREATE TABLE "letter_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "visible_to_employee_default" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "letter_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letter_template_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body_html" TEXT NOT NULL,
    "extra_fields" JSONB NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "letter_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_letters" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "employee_id" TEXT NOT NULL,
    "template_version_id" TEXT NOT NULL,
    "merge_values" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "generated_by_user_id" TEXT NOT NULL,
    "visible_to_employee" BOOLEAN NOT NULL,
    "status" "GeneratedLetterStatus" NOT NULL DEFAULT 'QUEUED',
    "failure_reason" TEXT,
    "employee_document_id" TEXT,
    "pdf_sha256" TEXT,
    "renderer_version" TEXT,
    "reissue_of_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "letter_templates_code_key" ON "letter_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "letter_template_versions_template_id_version_key" ON "letter_template_versions"("template_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "generated_letters_number_key" ON "generated_letters"("number");

-- CreateIndex
CREATE UNIQUE INDEX "generated_letters_employee_document_id_key" ON "generated_letters"("employee_document_id");

-- CreateIndex
CREATE INDEX "generated_letters_employee_id_idx" ON "generated_letters"("employee_id");

-- AddForeignKey
ALTER TABLE "letter_template_versions" ADD CONSTRAINT "letter_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "letter_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_letters" ADD CONSTRAINT "generated_letters_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_letters" ADD CONSTRAINT "generated_letters_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "letter_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_letters" ADD CONSTRAINT "generated_letters_employee_document_id_fkey" FOREIGN KEY ("employee_document_id") REFERENCES "employee_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_letters" ADD CONSTRAINT "generated_letters_reissue_of_id_fkey" FOREIGN KEY ("reissue_of_id") REFERENCES "generated_letters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Immutability (Phase 5 commit D2: letters are legal documents) ─────────
-- Enforced in the database, not just the service layer, so no code path,
-- admin tool or later bug can quietly rewrite what someone was sent.
-- DELETE is deliberately not blocked here (test cleanup needs it, and no
-- application path deletes these rows); generated_letters → employee_documents
-- is ON DELETE RESTRICT, so an issued letter's file can't be removed under it.

-- 1. A template version, once written, never changes.
CREATE FUNCTION letter_template_versions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'letter_template_versions are immutable — edit the template to create a new version'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER letter_template_versions_no_update
  BEFORE UPDATE ON "letter_template_versions"
  FOR EACH ROW EXECUTE FUNCTION letter_template_versions_immutable();

-- 2. An issued letter's content never changes. The only allowed update is
--    the worker finishing a QUEUED letter (→ GENERATED with its document,
--    hash and renderer version, or → FAILED with a reason), plus
--    reissue_of_id going to NULL if the letter it reissued is deleted.
CREATE FUNCTION generated_letters_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
     OR NEW.merge_values IS DISTINCT FROM OLD.merge_values
     OR NEW.generated_at IS DISTINCT FROM OLD.generated_at
     OR NEW.generated_by_user_id IS DISTINCT FROM OLD.generated_by_user_id
     OR NEW.visible_to_employee IS DISTINCT FROM OLD.visible_to_employee
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.reissue_of_id IS DISTINCT FROM OLD.reissue_of_id AND NEW.reissue_of_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'generated_letters % is an issued letter and cannot be changed — reissue it instead', OLD.number
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status <> 'QUEUED' AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.failure_reason IS DISTINCT FROM OLD.failure_reason
       OR NEW.employee_document_id IS DISTINCT FROM OLD.employee_document_id
       OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
       OR NEW.renderer_version IS DISTINCT FROM OLD.renderer_version)
  THEN
    RAISE EXCEPTION 'generated_letters % is already % and cannot be changed', OLD.number, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status = 'QUEUED' AND NEW.status = 'QUEUED' AND (
       NEW.employee_document_id IS DISTINCT FROM OLD.employee_document_id
       OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256)
  THEN
    RAISE EXCEPTION 'generated_letters %: a document and hash are only set when the letter is generated', OLD.number
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER generated_letters_no_rewrite
  BEFORE UPDATE ON "generated_letters"
  FOR EACH ROW EXECUTE FUNCTION generated_letters_immutable();

-- 3. An employee document's file is fixed once written — for every employee
--    document, not just letters. Title, category, visibility and archive
--    stay editable (letter documents' title/category are additionally
--    locked in the service layer).
CREATE FUNCTION employee_documents_file_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.file_key IS DISTINCT FROM OLD.file_key
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
  THEN
    RAISE EXCEPTION 'employee_documents: the stored file of document % cannot be replaced — upload a new document instead', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employee_documents_file_no_rewrite
  BEFORE UPDATE ON "employee_documents"
  FOR EACH ROW EXECUTE FUNCTION employee_documents_file_immutable();
