-- M session block 2, ER-28: custom fields on the employee record. Directors define the fields; HR fills them within its data scope. A field marked
-- sensitive keeps its value only encrypted (value_encrypted, AES-256-GCM via encryptField; registered for key rotation) with the last four
-- characters for a masked display; a plain field keeps value_text. Forward-only.
CREATE TABLE "custom_field_definitions" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "options" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "visible_to_employee" BOOLEAN NOT NULL DEFAULT false,
  "sensitive" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custom_field_definitions_type" CHECK ("type" IN ('TEXT', 'NUMBER', 'DATE', 'CHOICE')),
  CONSTRAINT "custom_field_definitions_key_shape" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT "custom_field_definitions_choice_has_options" CHECK (("type" = 'CHOICE') = (cardinality("options") > 0))
);
CREATE UNIQUE INDEX "custom_field_definitions_key_key" ON "custom_field_definitions"("key");

CREATE TABLE "employee_custom_values" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "field_id" TEXT NOT NULL,
  "value_text" TEXT,
  "value_encrypted" BYTEA,
  "value_last4" TEXT,
  "updated_by_user_id" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "employee_custom_values_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_custom_values_one_form" CHECK (("value_text" IS NULL) <> ("value_encrypted" IS NULL)),
  CONSTRAINT "employee_custom_values_last4_only_when_encrypted" CHECK ("value_last4" IS NULL OR "value_encrypted" IS NOT NULL)
);
CREATE UNIQUE INDEX "employee_custom_values_employee_id_field_id_key" ON "employee_custom_values"("employee_id", "field_id");
CREATE INDEX "employee_custom_values_field_id_idx" ON "employee_custom_values"("field_id");
ALTER TABLE "employee_custom_values" ADD CONSTRAINT "employee_custom_values_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_custom_values" ADD CONSTRAINT "employee_custom_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "custom_field_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
