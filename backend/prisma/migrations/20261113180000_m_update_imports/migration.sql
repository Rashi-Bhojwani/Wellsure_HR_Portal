-- M session block 2, IE-07 / IE-08: HR's update import of existing employees (contact and personal details; job changes with an effective date).
-- An upload is checked row by row into a batch (preview); applying writes through the employee service. Bank and statutory numbers are never in
-- this file. Forward-only.
CREATE TABLE "update_import_batches" (
  "id" TEXT NOT NULL,
  "uploaded_by_user_id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "rows" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "update_import_batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "update_import_batches_uploaded_by_user_id_created_at_idx" ON "update_import_batches"("uploaded_by_user_id", "created_at");
