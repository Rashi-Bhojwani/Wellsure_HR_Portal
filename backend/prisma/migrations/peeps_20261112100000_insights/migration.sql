-- PEEPS stage 2: Insights settings (append-only, director-written) and the insights.view key granted through Office membership.
-- CreateTable
CREATE TABLE "insights_setting_versions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB,
    "reason" TEXT NOT NULL,
    "changed_by_user_id" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insights_setting_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "insights_setting_versions_key_version_key" ON "insights_setting_versions"("key", "version");


CREATE FUNCTION peeps_insights_director() RETURNS trigger AS $$ BEGIN
 IF NOT peeps_is_director(NEW.changed_by_user_id) THEN RAISE EXCEPTION 'INSIGHTS_DIRECTOR_ONLY'; END IF;
 RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER insights_settings_director BEFORE INSERT ON insights_setting_versions FOR EACH ROW EXECUTE FUNCTION peeps_insights_director();
CREATE TRIGGER insights_settings_immutable BEFORE UPDATE OR DELETE ON insights_setting_versions FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only();
CREATE TRIGGER insights_settings_no_truncate BEFORE TRUNCATE ON insights_setting_versions FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only();

INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, 'insights.view', 'Aggregate Insights (small groups hidden); Wellsure Office members with the capability and the directors.'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'insights.view');
