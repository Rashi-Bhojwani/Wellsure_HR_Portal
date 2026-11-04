-- A-10 G1 (docs/plans/GREYTHR_PARITY_WORKFORCE.md): append-only Workforce settings (status labels, Manual Override's allowed statuses, later the rest). None seeded: Not set.
-- CreateTable
CREATE TABLE "workforce_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "set_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workforce_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workforce_settings_key_created_at_idx" ON "workforce_settings"("key", "created_at");


CREATE FUNCTION workforce_settings_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'WORKFORCE_SETTING_APPEND_ONLY: a Workforce setting is never changed in place; save a new value';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER workforce_settings_no_update BEFORE UPDATE ON "workforce_settings" FOR EACH ROW EXECUTE FUNCTION workforce_settings_append_only();
