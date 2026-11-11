-- M session, NT-09: a person's own notification choices. Forward-only.
CREATE TABLE "notification_preferences" (
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "muted" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","category"),
    CONSTRAINT "notification_preferences_category" CHECK ("category" IN ('DOCUMENTS', 'TEAM_CHANGES', 'LETTER_ASKS'))
);
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
