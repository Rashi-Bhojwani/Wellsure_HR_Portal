-- PY-41 (docs/plans/A_PARITY_ROWS.md part 2): which ledger account each journal key posts to, set by a director (none preset). Append-only; the newest per key wins.
CREATE TABLE "ledger_account_mappings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "set_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_account_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_account_mappings_texts" CHECK (length("key") >= 3 AND length("account") >= 1 AND length("reason") >= 3)
);
CREATE INDEX "ledger_account_mappings_key_idx" ON "ledger_account_mappings"("key", "created_at");
CREATE FUNCTION ledger_account_mappings_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'LEDGER_MAPPING_APPEND_ONLY: a mapping is never changed or deleted; set a new one';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_account_mappings_guard BEFORE UPDATE OR DELETE ON "ledger_account_mappings" FOR EACH ROW EXECUTE FUNCTION ledger_account_mappings_append_only();
