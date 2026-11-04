-- A-9 G3 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md): letters prepared in batches, signed by up to two signatories, issued through the existing path, voided (never deleted);
-- per-template grants to prepare or issue, set by a director. Nothing seeded: the serial sequence and every grant are Not set.
-- CreateEnum
CREATE TYPE "LetterRequestStatus" AS ENUM ('IN_PROGRESS', 'ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "LetterSignatoryStatus" AS ENUM ('PENDING', 'SIGNED');

-- CreateEnum
CREATE TYPE "LetterGrantAction" AS ENUM ('PREPARE', 'ISSUE');

-- CreateTable
CREATE TABLE "letter_requests" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "client_key" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "extra_values" JSONB NOT NULL DEFAULT '{}',
    "remarks" TEXT,
    "status" "LetterRequestStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "serial" TEXT,
    "prepared_by_user_id" TEXT NOT NULL,
    "prepared_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by_user_id" TEXT,
    "issued_at" TIMESTAMPTZ(3),
    "generated_letter_id" TEXT,
    "voided_by_user_id" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "letter_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letter_request_signatories" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "signatory_employee_id" TEXT NOT NULL,
    "status" "LetterSignatoryStatus" NOT NULL DEFAULT 'PENDING',
    "signed_at" TIMESTAMPTZ(3),
    "marked_by_user_id" TEXT,

    CONSTRAINT "letter_request_signatories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letter_template_grants" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "action" "LetterGrantAction" NOT NULL,
    "role_code" TEXT,
    "user_id" TEXT,
    "granted_by_user_id" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by_user_id" TEXT,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "letter_template_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "letter_requests_generated_letter_id_key" ON "letter_requests"("generated_letter_id");

-- CreateIndex
CREATE INDEX "letter_requests_status_prepared_at_idx" ON "letter_requests"("status", "prepared_at");

-- CreateIndex
CREATE INDEX "letter_requests_batch_id_idx" ON "letter_requests"("batch_id");

-- CreateIndex
CREATE INDEX "letter_requests_employee_id_idx" ON "letter_requests"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "letter_requests_prepared_by_user_id_client_key_employee_id_key" ON "letter_requests"("prepared_by_user_id", "client_key", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "letter_request_signatories_request_id_position_key" ON "letter_request_signatories"("request_id", "position");

-- CreateIndex
CREATE INDEX "letter_template_grants_template_id_action_idx" ON "letter_template_grants"("template_id", "action");

-- AddForeignKey
ALTER TABLE "letter_requests" ADD CONSTRAINT "letter_requests_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "letter_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letter_requests" ADD CONSTRAINT "letter_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letter_requests" ADD CONSTRAINT "letter_requests_generated_letter_id_fkey" FOREIGN KEY ("generated_letter_id") REFERENCES "generated_letters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letter_request_signatories" ADD CONSTRAINT "letter_request_signatories_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "letter_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letter_request_signatories" ADD CONSTRAINT "letter_request_signatories_signatory_employee_id_fkey" FOREIGN KEY ("signatory_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letter_template_grants" ADD CONSTRAINT "letter_template_grants_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "letter_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Guards the service also enforces: at most two signatories; an issued request names who issued it and when; a void one says who, when and why.
ALTER TABLE "letter_request_signatories" ADD CONSTRAINT "letter_request_signatories_position_check" CHECK ("position" IN (1, 2));
ALTER TABLE "letter_requests" ADD CONSTRAINT "letter_requests_issued_check" CHECK ("status" <> 'ISSUED' OR ("issued_at" IS NOT NULL AND "issued_by_user_id" IS NOT NULL));
ALTER TABLE "letter_requests" ADD CONSTRAINT "letter_requests_void_check" CHECK ("status" <> 'VOID' OR ("voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL AND length(trim("void_reason")) >= 3));
ALTER TABLE "letter_template_grants" ADD CONSTRAINT "letter_template_grants_subject_check" CHECK (("role_code" IS NULL) <> ("user_id" IS NULL));
