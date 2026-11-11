-- PEEPS C-4B: offers, director-only pay, joiner links and documents, joining exceptions, conversion, referrals.
-- Forward-only and additive: two nullable candidate columns and new tables; no existing value is read or changed.

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "expected_pay_changed_by_user_id" TEXT,
ADD COLUMN     "expected_pay_encrypted" BYTEA;

-- CreateTable
CREATE TABLE "recruitment_offers" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "reporting_manager_id" TEXT,
    "employment_type" TEXT NOT NULL,
    "joining_date" DATE NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "approval_required" BOOLEAN,
    "created_by_user_id" TEXT NOT NULL,
    "changed_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_offer_compensation" (
    "id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "value_encrypted" BYTEA,
    "version" INTEGER NOT NULL DEFAULT 1,
    "changed_by_user_id" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_offer_compensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_offer_events" (
    "id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "reason" TEXT,
    "letter_reference" TEXT,
    "actor_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_offer_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_joiner_links" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_user_id" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_joiner_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_joiner_documents" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "type_code" TEXT NOT NULL,
    "storage_key" TEXT,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_user_id" TEXT,

    CONSTRAINT "recruitment_joiner_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_joining_exceptions" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "type_code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_joining_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_conversions" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "converted_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_referrals" (
    "id" TEXT NOT NULL,
    "referrer_employee_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "name_encrypted" BYTEA,
    "email_encrypted" BYTEA,
    "phone_encrypted" BYTEA,
    "consent_recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "retention_until" TIMESTAMPTZ(3) NOT NULL,
    "candidate_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "changed_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recruitment_offers_candidate_id_idx" ON "recruitment_offers"("candidate_id");

-- CreateIndex
CREATE INDEX "recruitment_offers_application_id_idx" ON "recruitment_offers"("application_id");

-- CreateIndex
CREATE INDEX "recruitment_offers_state_idx" ON "recruitment_offers"("state");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_offer_compensation_offer_id_key" ON "recruitment_offer_compensation"("offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_offer_events_offer_id_version_key" ON "recruitment_offer_events"("offer_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_joiner_links_token_hash_key" ON "recruitment_joiner_links"("token_hash");

-- CreateIndex
CREATE INDEX "recruitment_joiner_links_candidate_id_idx" ON "recruitment_joiner_links"("candidate_id");

-- CreateIndex
CREATE INDEX "recruitment_joiner_documents_candidate_id_idx" ON "recruitment_joiner_documents"("candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_joiner_documents_link_id_type_code_key" ON "recruitment_joiner_documents"("link_id", "type_code");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_joining_exceptions_candidate_id_type_code_key" ON "recruitment_joining_exceptions"("candidate_id", "type_code");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_conversions_candidate_id_key" ON "recruitment_conversions"("candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_conversions_offer_id_key" ON "recruitment_conversions"("offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_conversions_application_id_key" ON "recruitment_conversions"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_conversions_employee_id_key" ON "recruitment_conversions"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_referrals_candidate_id_key" ON "recruitment_referrals"("candidate_id");

-- CreateIndex
CREATE INDEX "recruitment_referrals_referrer_employee_id_idx" ON "recruitment_referrals"("referrer_employee_id");

-- CreateIndex
CREATE INDEX "recruitment_referrals_status_idx" ON "recruitment_referrals"("status");

-- AddForeignKey
ALTER TABLE "recruitment_offers" ADD CONSTRAINT "recruitment_offers_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_offers" ADD CONSTRAINT "recruitment_offers_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_offer_compensation" ADD CONSTRAINT "recruitment_offer_compensation_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "recruitment_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_offer_events" ADD CONSTRAINT "recruitment_offer_events_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "recruitment_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_joiner_links" ADD CONSTRAINT "recruitment_joiner_links_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_joiner_links" ADD CONSTRAINT "recruitment_joiner_links_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "recruitment_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_joiner_documents" ADD CONSTRAINT "recruitment_joiner_documents_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_joiner_documents" ADD CONSTRAINT "recruitment_joiner_documents_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "recruitment_joiner_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_joining_exceptions" ADD CONSTRAINT "recruitment_joining_exceptions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_conversions" ADD CONSTRAINT "recruitment_conversions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_conversions" ADD CONSTRAINT "recruitment_conversions_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "recruitment_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_referrals" ADD CONSTRAINT "recruitment_referrals_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_referrals" ADD CONSTRAINT "recruitment_referrals_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- PEEPS C-4B guards (forward-only; no existing row is changed).
ALTER TABLE recruitment_offers ADD CONSTRAINT recruitment_offer_state CHECK (state IN ('DRAFT','PROPOSED','APPROVED','ISSUED','ACCEPTED','DECLINED','EXPIRED','WITHDRAWN'));
ALTER TABLE recruitment_offers ADD CONSTRAINT recruitment_offer_employment CHECK (employment_type IN ('PERMANENT','CONTRACT','INTERN','CONSULTANT','PROBATION'));
-- One live offer per application.
CREATE UNIQUE INDEX recruitment_offers_one_live ON recruitment_offers(application_id) WHERE state IN ('DRAFT','PROPOSED','APPROVED','ISSUED','ACCEPTED');
ALTER TABLE recruitment_offer_events ADD CONSTRAINT recruitment_offer_event_kind CHECK (kind IN ('CREATED','STATE','COMPENSATION'));
ALTER TABLE recruitment_referrals ADD CONSTRAINT recruitment_referral_status CHECK (status IN ('SUBMITTED','ACCEPTED','CLOSED'));
ALTER TABLE recruitment_joiner_links ADD CONSTRAINT recruitment_joiner_link_expiry CHECK (expires_at > created_at);

-- Offer pay: written only by a director, whatever the code does. Key rotation keeps changed_by_user_id, so it still passes.
CREATE FUNCTION peeps_recruitment_offer_pay_director() RETURNS trigger AS $$ BEGIN
 IF NOT peeps_is_director(NEW.changed_by_user_id) THEN RAISE EXCEPTION 'RECRUITMENT_OFFER_PAY_DIRECTOR_ONLY'; END IF;
 RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER recruitment_offer_pay_director BEFORE INSERT OR UPDATE ON recruitment_offer_compensation FOR EACH ROW EXECUTE FUNCTION peeps_recruitment_offer_pay_director();

-- Append-only ledgers: offer events, joining exceptions and conversions. The app role loses UPDATE/DELETE/TRUNCATE (dbRoles).
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['recruitment_offer_events','recruitment_joining_exceptions','recruitment_conversions'] LOOP
 EXECUTE format('CREATE TRIGGER recruitment_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only()',t);
 EXECUTE format('CREATE TRIGGER recruitment_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only()',t);
 END LOOP; END; $$;

-- HR onboarding switch (default ON through the HR role's own permission; a director may switch it OFF). Additive; every existing choice kept.
ALTER TABLE hr_capability_switches DROP CONSTRAINT hr_capability_switches_capability_check;
ALTER TABLE hr_capability_switches ADD CONSTRAINT hr_capability_switches_capability_check CHECK (capability IN ('VIEW_ATTENDANCE','APPROVE_REGULARIZATIONS','APPROVE_LEAVE','EDIT_MUSTER','UPLOAD_MANUAL_MUSTER','FINALISE_MONTH','CORRECTIONS','SHIFT_ROSTER','EXCEPTIONS_QUEUE','ATTENDANCE_REPORTS','LEAVE_REPORTS','SEE_LEAVE_COUNTS','SEND_INVITATIONS','IMPORT_EMPLOYEE_DETAILS','ISSUE_LETTERS_NO_PAY','MANAGE_EXITS','MANAGE_RECRUITMENT','RUN_ONBOARDING'));
-- An erased candidate keeps no expected pay.
ALTER TABLE candidates ADD CONSTRAINT recruitment_candidate_expected_pay_erased CHECK (anonymized_at IS NULL OR expected_pay_encrypted IS NULL);

-- Keys: HR onboarding (both HR roles hold it by default; the RUN_ONBOARDING switch can take it away) and director-only pay.
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, k.key, k.description FROM (VALUES
 ('recruitment.onboarding', 'Joining checks, joining documents and conversion of accepted candidates. Never pay.'),
 ('recruitment.pay.view', 'Offer pay and candidate expected pay: directors only, every opening audited.')) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = k.key);
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = 'recruitment.onboarding'
WHERE r.code IN ('HR_ADMIN', 'HR_EXECUTIVE')
ON CONFLICT DO NOTHING;
