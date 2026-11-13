-- M session block 2, AD-08: more than one company (legal entity). The existing company stays the main one (company table, unchanged); further entities
-- are kept here, and an employee may be assigned to one (no row = the main company). Nothing in payroll reads these tables yet (registrations, bank
-- file and statutory files per entity are Session A's: a request). Forward-only.
CREATE TABLE "legal_entities" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "registered_address" TEXT,
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legal_entities_code_shape" CHECK ("code" ~ '^[A-Z0-9_-]{1,20}$'),
  CONSTRAINT "legal_entities_name_given" CHECK (length(btrim("name")) >= 2)
);
CREATE UNIQUE INDEX "legal_entities_code_key" ON "legal_entities"("code");

CREATE TABLE "employee_legal_entities" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "legal_entity_id" TEXT NOT NULL,
  "set_by_user_id" TEXT NOT NULL,
  "set_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_legal_entities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_legal_entities_employee_id_key" ON "employee_legal_entities"("employee_id");
CREATE INDEX "employee_legal_entities_legal_entity_id_idx" ON "employee_legal_entities"("legal_entity_id");
ALTER TABLE "employee_legal_entities" ADD CONSTRAINT "employee_legal_entities_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_legal_entities" ADD CONSTRAINT "employee_legal_entities_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
