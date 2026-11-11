-- M session, RP-13: "email me this report" (a person's own subscription). Forward-only.
CREATE TABLE "report_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "report_key" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stopped_why" TEXT,
    "last_sent_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "report_subscriptions_frequency" CHECK ("frequency" IN ('WEEKLY', 'MONTHLY'))
);
CREATE UNIQUE INDEX "report_subscriptions_user_id_report_key_key" ON "report_subscriptions"("user_id", "report_key");
CREATE INDEX "report_subscriptions_active_idx" ON "report_subscriptions"("active");
ALTER TABLE "report_subscriptions" ADD CONSTRAINT "report_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
