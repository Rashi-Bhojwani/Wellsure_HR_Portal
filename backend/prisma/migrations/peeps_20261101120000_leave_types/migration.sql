-- Peeps: the four new leave types (Q-15 decided; docs/plans/PEEPS_PLAN.md "Final instructions", Module 2). Additive and forward-only.
-- The types are inactive rows with stable codes; nothing about them is set until a rule version is prepared and a different director approves it.

-- CreateTable
CREATE TABLE "leave_rule_versions" (
    "id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "prepared_by_user_id" TEXT NOT NULL,
    "prepared_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_rule_approvals" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "approved_by_user_id" TEXT NOT NULL,
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_from" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "leave_rule_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_request_documents" (
    "id" TEXT NOT NULL,
    "leave_request_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_request_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leave_rule_versions_leave_type_id_version_key" ON "leave_rule_versions"("leave_type_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "leave_rule_approvals_version_id_key" ON "leave_rule_approvals"("version_id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_request_documents_storage_key_key" ON "leave_request_documents"("storage_key");

-- CreateIndex
CREATE INDEX "leave_request_documents_leave_request_id_idx" ON "leave_request_documents"("leave_request_id");

-- AddForeignKey
ALTER TABLE "leave_rule_versions" ADD CONSTRAINT "leave_rule_versions_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_rule_approvals" ADD CONSTRAINT "leave_rule_approvals_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "leave_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request_documents" ADD CONSTRAINT "leave_request_documents_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Append-only: never changed or deleted (tests may purge their own fixtures), never truncated (so the app role loses UPDATE/DELETE) ──
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_rule_versions', 'leave_rule_approvals', 'leave_request_documents'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- A rule version is approved by a director who did not prepare it, whatever the code does.
CREATE OR REPLACE FUNCTION leave_rule_approvals_checker() RETURNS trigger AS $$
BEGIN
  IF NEW."approved_by_user_id" = (SELECT "prepared_by_user_id" FROM "leave_rule_versions" WHERE "id" = NEW."version_id") THEN
    RAISE EXCEPTION 'LEAVE_RULES_SAME_PERSON: the person who prepared leave rules cannot approve them';
  END IF;
  IF NOT peeps_is_director(NEW."approved_by_user_id") THEN
    RAISE EXCEPTION 'LEAVE_RULES_DIRECTORS_ONLY: only a director approves leave rules';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER leave_rule_approvals_checker BEFORE INSERT ON "leave_rule_approvals" FOR EACH ROW EXECUTE FUNCTION leave_rule_approvals_checker();

-- ── The four types: inactive until their rules are approved; the paid and half-day flags are set from the approved rules ──
INSERT INTO leave_types (id, code, name, is_paid, allow_half_day, is_active, created_at, updated_at)
SELECT gen_random_uuid()::text, t.code, t.name, false, false, false, now(), now()
FROM (VALUES ('MENSTRUAL', 'Menstrual Leave'), ('MEDICAL', 'Medical Leave'), ('WEDDING', 'Wedding Leave'), ('BEREAVEMENT', 'Bereavement Leave')) AS t(code, name)
WHERE NOT EXISTS (SELECT 1 FROM leave_types l WHERE l.code = t.code);

-- ── Who opens supporting documents: HR (both roles) and, holding every key, the directors ──
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, 'leave.documents.view', 'Open the supporting documents of the new leave types (every open is audited)'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'leave.documents.view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = 'leave.documents.view'
WHERE r.code IN ('HR_ADMIN', 'HR_EXECUTIVE')
ON CONFLICT DO NOTHING;
