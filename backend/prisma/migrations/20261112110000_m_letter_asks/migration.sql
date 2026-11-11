-- M session, LT-08: an employee asks for a letter. Forward-only.
CREATE TABLE "letter_asks" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASKED',
    "letter_request_id" TEXT,
    "note" TEXT,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "letter_asks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "letter_asks_status" CHECK ("status" IN ('ASKED', 'DONE', 'DECLINED', 'WITHDRAWN')),
    CONSTRAINT "letter_asks_purpose_given" CHECK (length(btrim("purpose")) >= 3),
    CONSTRAINT "letter_asks_decided" CHECK (("status" = 'ASKED') = ("decided_at" IS NULL)),
    CONSTRAINT "letter_asks_decline_reason" CHECK ("status" <> 'DECLINED' OR length(btrim(coalesce("note", ''))) >= 3)
);
CREATE INDEX "letter_asks_status_created_at_idx" ON "letter_asks"("status", "created_at");
CREATE INDEX "letter_asks_employee_id_status_idx" ON "letter_asks"("employee_id", "status");
-- One open ask per person and template.
CREATE UNIQUE INDEX "letter_asks_one_open" ON "letter_asks"("employee_id", "template_id") WHERE "status" = 'ASKED';
ALTER TABLE "letter_asks" ADD CONSTRAINT "letter_asks_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "letter_asks" ADD CONSTRAINT "letter_asks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "letter_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A decided ask is the record: it is never changed again.
CREATE OR REPLACE FUNCTION letter_asks_decided_fixed() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'ASKED' THEN RAISE EXCEPTION 'LETTER_ASK_DECIDED: a decided letter ask is never changed'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "letter_asks_decided_fixed" BEFORE UPDATE ON "letter_asks" FOR EACH ROW EXECUTE FUNCTION letter_asks_decided_fixed();
