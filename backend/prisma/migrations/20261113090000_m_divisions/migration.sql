-- M session block 2, ER-27: divisions, an optional grouping of departments. A department belongs to at most one division; an employee's division
-- is their department's, so it follows the effective-dated job history. Forward-only.
CREATE TABLE "divisions" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "divisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "divisions_code_shape" CHECK ("code" ~ '^[A-Z0-9_-]{1,20}$'),
  CONSTRAINT "divisions_name_given" CHECK (length(btrim("name")) >= 2)
);
CREATE UNIQUE INDEX "divisions_code_key" ON "divisions"("code");
CREATE UNIQUE INDEX "divisions_name_key" ON "divisions"("name");

CREATE TABLE "department_divisions" (
  "id" TEXT NOT NULL,
  "department_id" TEXT NOT NULL,
  "division_id" TEXT NOT NULL,
  "set_by_user_id" TEXT NOT NULL,
  "set_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "department_divisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "department_divisions_department_id_key" ON "department_divisions"("department_id");
CREATE INDEX "department_divisions_division_id_idx" ON "department_divisions"("division_id");
ALTER TABLE "department_divisions" ADD CONSTRAINT "department_divisions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "department_divisions" ADD CONSTRAINT "department_divisions_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
