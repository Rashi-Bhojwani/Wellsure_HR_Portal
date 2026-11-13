-- Peeps Stage 3 follow-ups: withdrawing a pending Peeps setting version or Office membership change (author or a director, never once decided),
-- and employees' asset requests (append-only events). Forward-only, additive.

-- CreateEnum
CREATE TYPE "AssetRequestEventKind" AS ENUM ('APPROVED', 'DECLINED', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "peeps_setting_withdrawals" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "withdrawn_by_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peeps_setting_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_membership_withdrawals" (
    "id" TEXT NOT NULL,
    "change_id" TEXT NOT NULL,
    "withdrawn_by_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "office_membership_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_requests" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "category_code" TEXT NOT NULL,
    "note" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_request_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "kind" "AssetRequestEventKind" NOT NULL,
    "by_user_id" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "peeps_setting_withdrawals_version_id_key" ON "peeps_setting_withdrawals"("version_id");

-- CreateIndex
CREATE UNIQUE INDEX "office_membership_withdrawals_change_id_key" ON "office_membership_withdrawals"("change_id");

-- CreateIndex
CREATE INDEX "asset_requests_employee_id_idx" ON "asset_requests"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_requests_employee_id_idempotency_key_key" ON "asset_requests"("employee_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "asset_request_events_request_id_idx" ON "asset_request_events"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_request_events_request_id_kind_key" ON "asset_request_events"("request_id", "kind");

-- AddForeignKey
ALTER TABLE "peeps_setting_withdrawals" ADD CONSTRAINT "peeps_setting_withdrawals_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "peeps_setting_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_membership_withdrawals" ADD CONSTRAINT "office_membership_withdrawals_change_id_fkey" FOREIGN KEY ("change_id") REFERENCES "office_membership_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_request_events" ADD CONSTRAINT "asset_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "asset_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "peeps_setting_withdrawals" ADD CONSTRAINT "peeps_setting_withdrawals_reason" CHECK (length(btrim("reason")) >= 3);
ALTER TABLE "office_membership_withdrawals" ADD CONSTRAINT "office_membership_withdrawals_reason" CHECK (length(btrim("reason")) >= 3);
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_note_length" CHECK ("note" IS NULL OR length("note") <= 300);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['peeps_setting_withdrawals', 'office_membership_withdrawals', 'asset_requests', 'asset_request_events'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- A decided proposal cannot be withdrawn, and a withdrawn one cannot be decided.
CREATE OR REPLACE FUNCTION peeps_withdrawal_checker() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'peeps_setting_withdrawals' THEN
    IF EXISTS (SELECT 1 FROM "peeps_setting_confirmations" c WHERE c."version_id" = NEW."version_id") THEN
      RAISE EXCEPTION 'PEEPS_ALREADY_DECIDED: a confirmed setting version cannot be withdrawn';
    END IF;
  ELSIF TG_TABLE_NAME = 'office_membership_withdrawals' THEN
    IF EXISTS (SELECT 1 FROM "office_membership_confirmations" c WHERE c."change_id" = NEW."change_id") THEN
      RAISE EXCEPTION 'PEEPS_ALREADY_DECIDED: a confirmed membership change cannot be withdrawn';
    END IF;
  ELSIF TG_TABLE_NAME = 'peeps_setting_confirmations' THEN
    IF EXISTS (SELECT 1 FROM "peeps_setting_withdrawals" w WHERE w."version_id" = NEW."version_id") THEN
      RAISE EXCEPTION 'PEEPS_WITHDRAWN: a withdrawn setting version cannot be confirmed';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "office_membership_withdrawals" w WHERE w."change_id" = NEW."change_id") THEN
      RAISE EXCEPTION 'PEEPS_WITHDRAWN: a withdrawn membership change cannot be confirmed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER peeps_setting_withdrawals_checker BEFORE INSERT ON "peeps_setting_withdrawals" FOR EACH ROW EXECUTE FUNCTION peeps_withdrawal_checker();
CREATE TRIGGER office_membership_withdrawals_checker BEFORE INSERT ON "office_membership_withdrawals" FOR EACH ROW EXECUTE FUNCTION peeps_withdrawal_checker();
CREATE TRIGGER peeps_setting_confirmations_not_withdrawn BEFORE INSERT ON "peeps_setting_confirmations" FOR EACH ROW EXECUTE FUNCTION peeps_withdrawal_checker();
CREATE TRIGGER office_membership_confirmations_not_withdrawn BEFORE INSERT ON "office_membership_confirmations" FOR EACH ROW EXECUTE FUNCTION peeps_withdrawal_checker();

-- Only the employee who asked cancels their own asset request.
CREATE OR REPLACE FUNCTION peeps_asset_request_cancel_by_requester() RETURNS trigger AS $$
BEGIN
  IF NEW."kind" = 'CANCELLED' AND NOT EXISTS (
    SELECT 1 FROM "asset_requests" r JOIN "users" u ON u."employee_id" = r."employee_id" WHERE r."id" = NEW."request_id" AND u."id" = NEW."by_user_id"
  ) THEN
    RAISE EXCEPTION 'PEEPS_ASSET_REQUEST_CANCEL: only the employee who asked cancels an asset request';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER asset_request_events_cancel BEFORE INSERT ON "asset_request_events" FOR EACH ROW EXECUTE FUNCTION peeps_asset_request_cancel_by_requester();
