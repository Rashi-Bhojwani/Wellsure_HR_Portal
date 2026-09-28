-- CreateEnum
CREATE TYPE "ImportDataset" AS ENUM ('ORG_MASTERS', 'EMPLOYEES', 'STATUTORY', 'BANK');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('VALIDATED', 'COMMITTED');

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "dataset" "ImportDataset" NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'VALIDATED',
    "total_rows" INTEGER NOT NULL,
    "valid_rows" INTEGER NOT NULL,
    "error_rows" INTEGER NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_by_user_id" TEXT,
    "committed_at" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_staging_rows" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_staging_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_dataset_status_idx" ON "import_batches"("dataset", "status");

-- CreateIndex
CREATE INDEX "import_staging_rows_batch_id_idx" ON "import_staging_rows"("batch_id");

-- AddForeignKey
ALTER TABLE "import_staging_rows" ADD CONSTRAINT "import_staging_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
