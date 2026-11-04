-- A-9 G7 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md): separation modes as company data (none seeded: Not set) and an optional mode on a separation.
-- AlterTable
ALTER TABLE "separations" ADD COLUMN     "mode_id" TEXT;

-- CreateTable
CREATE TABLE "separation_modes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "separation_modes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "separation_modes_code_key" ON "separation_modes"("code");

-- AddForeignKey
ALTER TABLE "separations" ADD CONSTRAINT "separations_mode_id_fkey" FOREIGN KEY ("mode_id") REFERENCES "separation_modes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

