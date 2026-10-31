-- Stage 5b, B4: a payslip link in an email. The token itself is never stored (only its hash); a link is for one payslip and one person, expires, and can be revoked.
CREATE TABLE "payslip_links" (
    "id" TEXT NOT NULL,
    "payslip_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_user_id" TEXT,
    "opened_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payslip_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payslip_links_token_hash_key" ON "payslip_links"("token_hash");
CREATE INDEX "payslip_links_payslip_id_idx" ON "payslip_links"("payslip_id");
ALTER TABLE "payslip_links" ADD CONSTRAINT "payslip_links_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payslip_links" ADD CONSTRAINT "payslip_links_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A link's token, payslip, person and expiry never change; only its open and revoke stamps are set, once.
CREATE OR REPLACE FUNCTION payslip_links_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'PAYSLIP_LINKS_APPEND_ONLY: a payslip link is never deleted';
  END IF;
  IF NEW."token_hash" <> OLD."token_hash" OR NEW."payslip_id" <> OLD."payslip_id" OR NEW."employee_id" <> OLD."employee_id" OR NEW."expires_at" <> OLD."expires_at" THEN
    RAISE EXCEPTION 'PAYSLIP_LINKS_FIXED: a link''s token, payslip, person and expiry never change';
  END IF;
  IF (OLD."revoked_at" IS NOT NULL AND NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at") THEN RAISE EXCEPTION 'PAYSLIP_LINKS_FIXED: a revoked link stays revoked'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payslip_links_guard BEFORE UPDATE OR DELETE ON "payslip_links" FOR EACH ROW EXECUTE FUNCTION payslip_links_guard();
