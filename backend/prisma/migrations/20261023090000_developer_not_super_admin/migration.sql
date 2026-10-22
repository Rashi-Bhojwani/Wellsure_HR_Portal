-- P6-6 (docs/plans/PHASE_6.md §14J): the person who builds and runs the system must never also be a Super Admin, because a Super Admin holds every permission, the owners'
-- secrets among them. The service refuses first with a clear message (modules/access/service.ts); this trigger makes it impossible by any path, a script or a direct INSERT included.
-- (lib/permissions.ts additionally strips every sensitive key from anyone holding the DEVELOPER role, so even a row that got past this could open nothing.)

CREATE FUNCTION user_roles_developer_not_super_admin() RETURNS trigger AS $$
DECLARE
  new_code TEXT;
  other_code TEXT;
BEGIN
  SELECT "code" INTO new_code FROM "roles" WHERE "id" = NEW."role_id";
  IF new_code = 'DEVELOPER' THEN
    other_code := 'SUPER_ADMIN';
  ELSIF new_code = 'SUPER_ADMIN' THEN
    other_code := 'DEVELOPER';
  ELSE
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id"
    WHERE ur."user_id" = NEW."user_id" AND r."code" = other_code
  ) THEN
    RAISE EXCEPTION 'DEVELOPER_NOT_SUPER_ADMIN: a person cannot be both a developer and a Super Admin';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_roles_developer_not_super_admin
  BEFORE INSERT ON "user_roles"
  FOR EACH ROW EXECUTE FUNCTION user_roles_developer_not_super_admin();
