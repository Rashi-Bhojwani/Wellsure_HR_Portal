-- Standard statutory defaults pack (docs/plans/STATUTORY_DEFAULTS_PLAN.md), Session A: each director's one-time acknowledgement ("I have reviewed the standard
-- values") and each later review, with the pack version it was given for. A record of who said what, when: never changed, never removed (the tests' purge
-- exception is the one way out, as for every payroll record).

CREATE TYPE "StatutoryPackReviewKind" AS ENUM ('ACKNOWLEDGED', 'REVIEWED');

CREATE TABLE "statutory_pack_reviews" (
    "id" TEXT NOT NULL,
    "kind" "StatutoryPackReviewKind" NOT NULL,
    "pack_version" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statutory_pack_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "statutory_pack_reviews_kind_created_at_idx" ON "statutory_pack_reviews"("kind", "created_at");
-- One acknowledgement per director (a second click is refused by the service and, if it races, by this index).
CREATE UNIQUE INDEX "statutory_pack_reviews_one_ack_per_user" ON "statutory_pack_reviews"("user_id") WHERE "kind" = 'ACKNOWLEDGED';

CREATE TRIGGER "statutory_pack_reviews_guard" BEFORE INSERT OR UPDATE OR DELETE ON "statutory_pack_reviews" FOR EACH ROW EXECUTE FUNCTION payroll_p65_append_only();
CREATE TRIGGER statutory_pack_reviews_no_truncate BEFORE TRUNCATE ON "statutory_pack_reviews" FOR EACH STATEMENT EXECUTE FUNCTION payroll_logs_no_truncate();
