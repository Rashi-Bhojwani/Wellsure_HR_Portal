-- D-37 (docs/plans/D37_DEFAULTS.md): behaviour settings. A director proposes a value with a reason; a different director confirms it. Both tables are append-only.
CREATE TABLE "behaviour_proposals" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "proposed_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "behaviour_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "behaviour_proposals_reason_given" CHECK (length(btrim("reason")) >= 3)
);
CREATE INDEX "behaviour_proposals_key_created_at_idx" ON "behaviour_proposals"("key", "created_at");

CREATE TABLE "behaviour_confirmations" (
  "id" TEXT NOT NULL,
  "proposal_id" TEXT NOT NULL,
  "confirmed_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "behaviour_confirmations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "behaviour_confirmations_proposal_id_key" ON "behaviour_confirmations"("proposal_id");
ALTER TABLE "behaviour_confirmations" ADD CONSTRAINT "behaviour_confirmations_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "behaviour_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION behaviour_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'BEHAVIOUR_APPEND_ONLY: a behaviour proposal or confirmation is never changed or removed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "behaviour_proposals_immutable" BEFORE UPDATE OR DELETE ON "behaviour_proposals" FOR EACH ROW EXECUTE FUNCTION behaviour_immutable();
CREATE TRIGGER "behaviour_confirmations_immutable" BEFORE UPDATE OR DELETE ON "behaviour_confirmations" FOR EACH ROW EXECUTE FUNCTION behaviour_immutable();

CREATE OR REPLACE FUNCTION behaviour_confirmation_other_person() RETURNS trigger AS $$
BEGIN
  IF (SELECT "proposed_by_user_id" FROM "behaviour_proposals" WHERE "id" = NEW."proposal_id") = NEW."confirmed_by_user_id" THEN
    RAISE EXCEPTION 'BEHAVIOUR_SAME_PERSON: the director who proposed a change does not confirm it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "behaviour_confirmations_other_person" BEFORE INSERT ON "behaviour_confirmations" FOR EACH ROW EXECUTE FUNCTION behaviour_confirmation_other_person();
