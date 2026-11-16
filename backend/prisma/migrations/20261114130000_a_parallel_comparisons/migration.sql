-- Stage 8 (docs/plans/STAGE_8_PLAN.md), Session A: saved parallel-run comparisons, the result encrypted (lib/fieldKeyRotation.ts).
-- CreateTable
CREATE TABLE "payroll_parallel_comparisons" (
    "id" TEXT NOT NULL,
    "cycle_start" DATE NOT NULL,
    "run_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "result_encrypted" BYTEA NOT NULL,
    "counts" JSONB NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_parallel_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_parallel_comparisons_cycle_start_created_at_idx" ON "payroll_parallel_comparisons"("cycle_start", "created_at");

