-- A-9 G1 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md): saved employee filters and segments, and the columns a person chose on a grid. Two new keys, held by the HR roles by default (no pay data in either).
-- CreateEnum
CREATE TYPE "EmployeeSegmentKind" AS ENUM ('FILTER', 'LIST');

-- CreateTable
CREATE TABLE "employee_segments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "EmployeeSegmentKind" NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "owner_user_id" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_segment_members" (
    "id" TEXT NOT NULL,
    "segment_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,

    CONSTRAINT "employee_segment_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_grid_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "grid_key" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_grid_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_segments_owner_user_id_idx" ON "employee_segments"("owner_user_id");

-- CreateIndex
CREATE INDEX "employee_segment_members_employee_id_idx" ON "employee_segment_members"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_segment_members_segment_id_employee_id_key" ON "employee_segment_members"("segment_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_grid_preferences_user_id_grid_key_key" ON "user_grid_preferences"("user_id", "grid_key");

-- AddForeignKey
ALTER TABLE "employee_segments" ADD CONSTRAINT "employee_segments_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_segment_members" ADD CONSTRAINT "employee_segment_members_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "employee_segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_segment_members" ADD CONSTRAINT "employee_segment_members_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_grid_preferences" ADD CONSTRAINT "user_grid_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES
  ('employee.segments.manage', 'Saved employee filters and segments'),
  ('employee.contact.reveal', 'Reveal contact numbers')
) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = k.key);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key IN ('employee.segments.manage', 'employee.contact.reveal')
WHERE r.code IN ('HR_ADMIN', 'HR_EXECUTIVE')
ON CONFLICT DO NOTHING;
