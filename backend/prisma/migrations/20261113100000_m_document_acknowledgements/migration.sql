-- M session block 2, ER-18: a company document can require acknowledgement; people in its audience acknowledge it once. Both tables append-only
-- (the requirement's latest row is in force; an acknowledgement is never changed or removed outside the test purge). Forward-only.
CREATE TABLE "company_document_ack_requirements" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL,
  "set_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_document_ack_requirements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "company_document_ack_requirements_document_id_created_at_idx" ON "company_document_ack_requirements"("document_id", "created_at");
ALTER TABLE "company_document_ack_requirements" ADD CONSTRAINT "company_document_ack_requirements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "company_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "company_document_acknowledgements" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_document_acknowledgements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "company_document_acknowledgements_document_id_employee_id_key" ON "company_document_acknowledgements"("document_id", "employee_id");
CREATE INDEX "company_document_acknowledgements_employee_id_idx" ON "company_document_acknowledgements"("employee_id");
ALTER TABLE "company_document_acknowledgements" ADD CONSTRAINT "company_document_acknowledgements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "company_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "company_document_acknowledgements" ADD CONSTRAINT "company_document_acknowledgements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION m_document_ack_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'DOCUMENT_ACK_APPEND_ONLY: acknowledgements and their requirement are never changed or removed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "company_document_ack_requirements_append_only" BEFORE UPDATE OR DELETE ON "company_document_ack_requirements" FOR EACH ROW EXECUTE FUNCTION m_document_ack_append_only();
CREATE TRIGGER "company_document_acknowledgements_append_only" BEFORE UPDATE OR DELETE ON "company_document_acknowledgements" FOR EACH ROW EXECUTE FUNCTION m_document_ack_append_only();
