-- Peeps: Wellsure Office workspace (membership, settings) and Unmute (owner decisions D-28, D-29, D-30). Additive only: new tables, new
-- permission keys (granted to nobody: directors hold every key in code; members receive them as per-person grants when a membership applies).

-- CreateEnum
CREATE TYPE "OfficeChangeKind" AS ENUM ('APPOINT', 'UPDATE', 'REMOVE', 'REPLACE');

-- CreateEnum
CREATE TYPE "UnmuteHostAction" AS ENUM ('AUTHORISE', 'REVOKE');

-- CreateEnum
CREATE TYPE "UnmuteSlotStatus" AS ENUM ('OPEN', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "UnmuteBookingStatus" AS ENUM ('BOOKED', 'CANCELLED', 'RESCHEDULED', 'COMPLETED', 'NOT_HELD');

-- CreateEnum
CREATE TYPE "UnmuteCancelledBy" AS ENUM ('BOOKER', 'HOST', 'SYSTEM');

-- CreateTable
CREATE TABLE "peeps_setting_versions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "entered_by_user_id" TEXT NOT NULL,
    "entered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peeps_setting_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peeps_setting_confirmations" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "confirmed_by_user_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peeps_setting_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_membership_changes" (
    "id" TEXT NOT NULL,
    "kind" "OfficeChangeKind" NOT NULL,
    "employee_id" TEXT NOT NULL,
    "from_employee_id" TEXT,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "proposed_by_user_id" TEXT NOT NULL,
    "proposed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "office_membership_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_membership_confirmations" (
    "id" TEXT NOT NULL,
    "change_id" TEXT NOT NULL,
    "confirmed_by_user_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "office_membership_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_membership_applications" (
    "id" TEXT NOT NULL,
    "change_id" TEXT NOT NULL,
    "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grants_added" INTEGER NOT NULL,
    "grants_removed" INTEGER NOT NULL,

    CONSTRAINT "office_membership_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unmute_host_authorisations" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "action" "UnmuteHostAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "by_user_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unmute_host_authorisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unmute_slots" (
    "id" TEXT NOT NULL,
    "host_employee_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "UnmuteSlotStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMPTZ(3),

    CONSTRAINT "unmute_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unmute_bookings" (
    "id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "host_employee_id" TEXT NOT NULL,
    "booker_employee_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "UnmuteBookingStatus" NOT NULL DEFAULT 'BOOKED',
    "booked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" "UnmuteCancelledBy",
    "rescheduled_at" TIMESTAMPTZ(3),
    "rescheduled_to_id" TEXT,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "unmute_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "peeps_setting_versions_key_version_key" ON "peeps_setting_versions"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "peeps_setting_confirmations_version_id_key" ON "peeps_setting_confirmations"("version_id");

-- CreateIndex
CREATE INDEX "office_membership_changes_employee_id_idx" ON "office_membership_changes"("employee_id");

-- CreateIndex
CREATE INDEX "office_membership_changes_effective_from_idx" ON "office_membership_changes"("effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "office_membership_confirmations_change_id_key" ON "office_membership_confirmations"("change_id");

-- CreateIndex
CREATE UNIQUE INDEX "office_membership_applications_change_id_key" ON "office_membership_applications"("change_id");

-- CreateIndex
CREATE INDEX "unmute_host_authorisations_employee_id_at_idx" ON "unmute_host_authorisations"("employee_id", "at");

-- CreateIndex
CREATE INDEX "unmute_slots_host_employee_id_starts_at_idx" ON "unmute_slots"("host_employee_id", "starts_at");

-- CreateIndex
CREATE INDEX "unmute_bookings_booker_employee_id_idx" ON "unmute_bookings"("booker_employee_id");

-- CreateIndex
CREATE INDEX "unmute_bookings_host_employee_id_idx" ON "unmute_bookings"("host_employee_id");

-- AddForeignKey
ALTER TABLE "peeps_setting_confirmations" ADD CONSTRAINT "peeps_setting_confirmations_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "peeps_setting_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_membership_changes" ADD CONSTRAINT "office_membership_changes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_membership_confirmations" ADD CONSTRAINT "office_membership_confirmations_change_id_fkey" FOREIGN KEY ("change_id") REFERENCES "office_membership_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_membership_applications" ADD CONSTRAINT "office_membership_applications_change_id_fkey" FOREIGN KEY ("change_id") REFERENCES "office_membership_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmute_host_authorisations" ADD CONSTRAINT "unmute_host_authorisations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmute_slots" ADD CONSTRAINT "unmute_slots_host_employee_id_fkey" FOREIGN KEY ("host_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmute_bookings" ADD CONSTRAINT "unmute_bookings_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "unmute_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmute_bookings" ADD CONSTRAINT "unmute_bookings_host_employee_id_fkey" FOREIGN KEY ("host_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmute_bookings" ADD CONSTRAINT "unmute_bookings_booker_employee_id_fkey" FOREIGN KEY ("booker_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Guards ───────────────────────────────────────────────────────────────

ALTER TABLE "peeps_setting_versions" ADD CONSTRAINT "peeps_setting_versions_version_positive" CHECK ("version" >= 1);
ALTER TABLE "office_membership_changes" ADD CONSTRAINT "office_membership_changes_reason" CHECK (length(btrim("reason")) >= 3);
ALTER TABLE "office_membership_changes" ADD CONSTRAINT "office_membership_changes_replace_from" CHECK (("kind" = 'REPLACE') = ("from_employee_id" IS NOT NULL));
ALTER TABLE "office_membership_changes" ADD CONSTRAINT "office_membership_changes_caps_list" CHECK (jsonb_typeof("capabilities") = 'array');
ALTER TABLE "unmute_host_authorisations" ADD CONSTRAINT "unmute_host_authorisations_reason" CHECK (length(btrim("reason")) >= 3);
ALTER TABLE "unmute_slots" ADD CONSTRAINT "unmute_slots_order" CHECK ("ends_at" > "starts_at");

-- One open slot per host and start time; one live booking per slot. Together: never two live bookings for the same host and slot, whatever the code does.
CREATE UNIQUE INDEX "unmute_slots_one_open" ON "unmute_slots" ("host_employee_id", "starts_at") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "unmute_bookings_one_live" ON "unmute_bookings" ("slot_id") WHERE "status" = 'BOOKED';

-- Append-only tables: settings versions and confirmations, membership proposals, confirmations and applications, host authorisations.
CREATE OR REPLACE FUNCTION peeps_core_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'PEEPS_APPEND_ONLY: % rows are never changed or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['peeps_setting_versions', 'peeps_setting_confirmations', 'office_membership_changes', 'office_membership_confirmations', 'office_membership_applications', 'unmute_host_authorisations'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only()', t || '_no_truncate', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION peeps_is_director(uid TEXT) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = uid AND r."code" = 'SUPER_ADMIN');
$$ LANGUAGE sql STABLE;

-- A setting is confirmed by a director who did not enter it.
CREATE OR REPLACE FUNCTION peeps_setting_confirmations_checker() RETURNS trigger AS $$
BEGIN
  IF (SELECT v."entered_by_user_id" FROM "peeps_setting_versions" v WHERE v."id" = NEW."version_id") = NEW."confirmed_by_user_id" THEN
    RAISE EXCEPTION 'PEEPS_SETTING_SAME_PERSON: the person who entered a setting cannot confirm it';
  END IF;
  IF NOT peeps_is_director(NEW."confirmed_by_user_id") THEN
    RAISE EXCEPTION 'PEEPS_SETTING_DIRECTORS_ONLY: only a director confirms a Peeps setting';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER peeps_setting_confirmations_checker BEFORE INSERT ON "peeps_setting_confirmations" FOR EACH ROW EXECUTE FUNCTION peeps_setting_confirmations_checker();

-- Membership: proposed by a director, confirmed by a different director.
CREATE OR REPLACE FUNCTION office_membership_changes_director() RETURNS trigger AS $$
BEGIN
  IF NOT peeps_is_director(NEW."proposed_by_user_id") THEN RAISE EXCEPTION 'OFFICE_DIRECTORS_ONLY: only a director proposes a Wellsure Office membership change'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER office_membership_changes_director BEFORE INSERT ON "office_membership_changes" FOR EACH ROW EXECUTE FUNCTION office_membership_changes_director();

CREATE OR REPLACE FUNCTION office_membership_confirmations_checker() RETURNS trigger AS $$
BEGIN
  IF (SELECT c."proposed_by_user_id" FROM "office_membership_changes" c WHERE c."id" = NEW."change_id") = NEW."confirmed_by_user_id" THEN
    RAISE EXCEPTION 'OFFICE_SAME_DIRECTOR: a different director confirms a membership change';
  END IF;
  IF NOT peeps_is_director(NEW."confirmed_by_user_id") THEN RAISE EXCEPTION 'OFFICE_DIRECTORS_ONLY: only a director confirms a membership change'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER office_membership_confirmations_checker BEFORE INSERT ON "office_membership_confirmations" FOR EACH ROW EXECUTE FUNCTION office_membership_confirmations_checker();

CREATE OR REPLACE FUNCTION office_membership_applications_confirmed() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "office_membership_confirmations" c WHERE c."change_id" = NEW."change_id") THEN
    RAISE EXCEPTION 'OFFICE_NOT_CONFIRMED: an unconfirmed membership change is never applied';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER office_membership_applications_confirmed BEFORE INSERT ON "office_membership_applications" FOR EACH ROW EXECUTE FUNCTION office_membership_applications_confirmed();

CREATE OR REPLACE FUNCTION unmute_host_authorisations_director() RETURNS trigger AS $$
BEGIN
  IF NOT peeps_is_director(NEW."by_user_id") THEN RAISE EXCEPTION 'UNMUTE_DIRECTORS_ONLY: only a director authorises or removes an Unmute host'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER unmute_host_authorisations_director BEFORE INSERT ON "unmute_host_authorisations" FOR EACH ROW EXECUTE FUNCTION unmute_host_authorisations_director();

-- Slots and bookings change state but are never deleted, and a booking only ever leaves BOOKED (once).
CREATE OR REPLACE FUNCTION unmute_no_delete() RETURNS trigger AS $$
BEGIN
  IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'UNMUTE_NO_DELETE: % rows are never deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER unmute_slots_no_delete BEFORE DELETE ON "unmute_slots" FOR EACH ROW EXECUTE FUNCTION unmute_no_delete();
CREATE TRIGGER unmute_bookings_no_delete BEFORE DELETE ON "unmute_bookings" FOR EACH ROW EXECUTE FUNCTION unmute_no_delete();

CREATE OR REPLACE FUNCTION unmute_bookings_transition() RETURNS trigger AS $$
BEGIN
  IF NEW."slot_id" IS DISTINCT FROM OLD."slot_id" OR NEW."host_employee_id" IS DISTINCT FROM OLD."host_employee_id" OR NEW."booker_employee_id" IS DISTINCT FROM OLD."booker_employee_id"
     OR NEW."booked_at" IS DISTINCT FROM OLD."booked_at" OR NEW."timezone" IS DISTINCT FROM OLD."timezone" THEN
    RAISE EXCEPTION 'UNMUTE_BOOKING_FIXED: who, when and which slot are never changed';
  END IF;
  IF OLD."status" <> 'BOOKED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'UNMUTE_BOOKING_FINAL: a booking that is no longer BOOKED does not change again';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER unmute_bookings_transition BEFORE UPDATE ON "unmute_bookings" FOR EACH ROW EXECUTE FUNCTION unmute_bookings_transition();

-- ── Permissions (new keys, held by nobody through a role) ──────────────────
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES
  ('assets.onboarding.issue', 'Issue assets at onboarding'),
  ('office.workspace', 'Open the Wellsure Office'),
  ('office.members.manage', 'Manage Wellsure Office members'),
  ('peeps.settings.manage', 'Prepare Peeps settings'),
  ('unmute.manage', 'Look after Unmute'),
  ('badges.give', 'Give badges'),
  ('nudges.send', 'Send private nudges')
) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = k.key);
