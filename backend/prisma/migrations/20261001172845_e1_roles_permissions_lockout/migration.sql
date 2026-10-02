-- CreateEnum
CREATE TYPE "RoleDataScope" AS ENUM ('SELF', 'TEAM', 'ALL');

-- CreateEnum
CREATE TYPE "PermissionOverrideEffect" AS ENUM ('GRANT', 'REVOKE');

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "data_scope" "RoleDataScope" NOT NULL DEFAULT 'SELF';

-- CreateTable
CREATE TABLE "user_permission_overrides" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "effect" "PermissionOverrideEffect" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_permission_overrides_user_id_permission_id_key" ON "user_permission_overrides"("user_id", "permission_id");

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Backfill: today's hardcoded scope mapping (lib/dataScope.ts before E1),
-- so behaviour is identical on day one. SUPER_ADMIN is ALL here too, though
-- the resolver forces ALL for it in code regardless.
UPDATE "roles" SET "data_scope" = 'ALL' WHERE "code" IN ('SUPER_ADMIN', 'HR_ADMIN', 'HR_EXECUTIVE', 'PAYROLL_ADMIN', 'APPROVER');
UPDATE "roles" SET "data_scope" = 'TEAM' WHERE "code" = 'MANAGER';

-- ── role.manage is retired: role definitions are changed only by holders of
-- the SUPER_ADMIN role itself (E1 rule 2), never by a grantable permission.
DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "key" = 'role.manage');
DELETE FROM "permissions" WHERE "key" = 'role.manage';

-- ── The last active SUPER_ADMIN can never be lost (E1 rule 7) ─────────────
-- The service layer refuses with a clear message first; these triggers make
-- it impossible by any path — a future endpoint, a script, a direct UPDATE.
-- They fire only when a change would take the count of ACTIVE users holding
-- SUPER_ADMIN from one to zero, so with two SUPER_ADMINs either can go, and
-- a fresh production database (zero, before the bootstrap CLI) is unaffected.
CREATE FUNCTION other_active_super_admin_exists(excluding_user TEXT) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM "user_roles" ur
    JOIN "roles" r ON r."id" = ur."role_id" AND r."code" = 'SUPER_ADMIN'
    JOIN "users" u ON u."id" = ur."user_id" AND u."status" = 'ACTIVE'
    WHERE ur."user_id" <> excluding_user
  );
$$ LANGUAGE sql STABLE;

CREATE FUNCTION user_is_active_super_admin(target_user TEXT) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM "user_roles" ur
    JOIN "roles" r ON r."id" = ur."role_id" AND r."code" = 'SUPER_ADMIN'
    JOIN "users" u ON u."id" = ur."user_id" AND u."status" = 'ACTIVE'
    WHERE ur."user_id" = target_user
  );
$$ LANGUAGE sql STABLE;

CREATE FUNCTION protect_last_super_admin_role() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR NEW."role_id" IS DISTINCT FROM OLD."role_id" OR NEW."user_id" IS DISTINCT FROM OLD."user_id")
     AND OLD."role_id" = (SELECT "id" FROM "roles" WHERE "code" = 'SUPER_ADMIN')
     AND user_is_active_super_admin(OLD."user_id")
     AND NOT other_active_super_admin_exists(OLD."user_id")
  THEN
    RAISE EXCEPTION 'LAST_SUPER_ADMIN: user % is the last active SUPER_ADMIN; the role cannot be removed', OLD."user_id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_roles_protect_last_super_admin
  BEFORE DELETE OR UPDATE ON "user_roles"
  FOR EACH ROW EXECUTE FUNCTION protect_last_super_admin_role();

CREATE FUNCTION protect_last_super_admin_user() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR (OLD."status" = 'ACTIVE' AND NEW."status" IS DISTINCT FROM 'ACTIVE'))
     AND user_is_active_super_admin(OLD."id")
     AND NOT other_active_super_admin_exists(OLD."id")
  THEN
    RAISE EXCEPTION 'LAST_SUPER_ADMIN: user % is the last active SUPER_ADMIN and cannot be deactivated, suspended or removed', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_protect_last_super_admin
  BEFORE DELETE OR UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION protect_last_super_admin_user();
