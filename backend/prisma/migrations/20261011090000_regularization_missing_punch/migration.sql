-- Attendance Info, Who Is In and the forgot-to-punch request (Phase 2 P2-E,
-- docs/plans/PHASE_2.md "P2-E build design"). Regularization's first kind,
-- brought forward from Phase 3 (user, 2026-10-09).


-- CreateEnum
CREATE TYPE "RegularizationKind" AS ENUM ('MISSING_PUNCH');

-- CreateEnum
CREATE TYPE "RegularizationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MissingPunchSide" AS ENUM ('IN', 'OUT');

-- AlterTable
ALTER TABLE "daily_attendance" ADD COLUMN     "override_kind" TEXT,
ADD COLUMN     "override_ref" TEXT;

-- CreateTable
CREATE TABLE "regularization_requests" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "RegularizationKind" NOT NULL DEFAULT 'MISSING_PUNCH',
    "missing" "MissingPunchSide" NOT NULL,
    "time" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RegularizationStatus" NOT NULL DEFAULT 'PENDING',
    "raised_by_user_id" TEXT NOT NULL,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regularization_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regularization_requests_employee_id_date_idx" ON "regularization_requests"("employee_id", "date");

-- CreateIndex
CREATE INDEX "regularization_requests_status_idx" ON "regularization_requests"("status");

-- AddForeignKey
ALTER TABLE "regularization_requests" ADD CONSTRAINT "regularization_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One open request per employee-day, and at most one approved correction.
CREATE UNIQUE INDEX "regularization_requests_one_pending" ON "regularization_requests"("employee_id", "date") WHERE status = 'PENDING';
CREATE UNIQUE INDEX "regularization_requests_one_approved" ON "regularization_requests"("employee_id", "date") WHERE status = 'APPROVED';
ALTER TABLE "regularization_requests" ADD CONSTRAINT "regularization_requests_time" CHECK (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "regularization_requests" ADD CONSTRAINT "regularization_requests_decided" CHECK ((status IN ('APPROVED', 'REJECTED')) = (decided_at IS NOT NULL));

-- Permissions (spec §2.2: "view and approve regularizations for their own
-- team ... two grantable keys, TEAM scope, IDOR-tested"). HR holds both;
-- a manager only by grant.
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES
  ('attendance.regularization.view', 'View regularization requests'),
  ('attendance.regularization.approve', 'Approve regularization requests')
) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = k.key);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key IN ('attendance.regularization.view', 'attendance.regularization.approve')
WHERE r.code IN ('HR_ADMIN', 'HR_EXECUTIVE')
ON CONFLICT DO NOTHING;
