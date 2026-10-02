-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "on_behalf_of_user_id" TEXT;

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "decided_on_behalf_of_user_id" TEXT;

-- CreateTable
CREATE TABLE "workflow_delegates" (
    "id" TEXT NOT NULL,
    "delegator_user_id" TEXT NOT NULL,
    "delegate_user_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "revoke_reason" TEXT,

    CONSTRAINT "workflow_delegates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_delegates_delegator_user_id_idx" ON "workflow_delegates"("delegator_user_id");

-- CreateIndex
CREATE INDEX "workflow_delegates_delegate_user_id_idx" ON "workflow_delegates"("delegate_user_id");

-- AddForeignKey
ALTER TABLE "workflow_delegates" ADD CONSTRAINT "workflow_delegates_delegator_user_id_fkey" FOREIGN KEY ("delegator_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_delegates" ADD CONSTRAINT "workflow_delegates_delegate_user_id_fkey" FOREIGN KEY ("delegate_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A delegation is a real range and never names the delegator as their own
-- delegate — enforced here as well as in the service.
ALTER TABLE "workflow_delegates" ADD CONSTRAINT "workflow_delegates_range_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "workflow_delegates" ADD CONSTRAINT "workflow_delegates_not_self_check" CHECK ("delegator_user_id" <> "delegate_user_id");

-- delegation.manage (HR sees and manages anyone's delegations), held by
-- HR_ADMIN by default — applied here once, as in the E2 migration, because
-- ensureAccessCatalog() never edits an existing role.
INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid()::text, 'delegation.manage', 'Manage workflow delegations'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."key" = 'delegation.manage');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'delegation.manage'
WHERE r."code" = 'HR_ADMIN'
ON CONFLICT DO NOTHING;
