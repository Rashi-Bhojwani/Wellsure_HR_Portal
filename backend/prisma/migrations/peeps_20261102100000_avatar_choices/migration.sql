-- Peeps D-35: avatar choices (photo, initials, a character or a fun pick). Additive; append-only; only the person chooses their own (service).
-- CreateEnum
CREATE TYPE "AvatarKind" AS ENUM ('PHOTO', 'INITIALS', 'CHARACTER', 'FUN');

-- CreateTable
CREATE TABLE "employee_avatar_choices" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "kind" "AvatarKind" NOT NULL,
    "catalogue_id" TEXT,
    "idempotency_key" TEXT,
    "chosen_by_user_id" TEXT NOT NULL,
    "chosen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_avatar_choices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_avatar_choices_employee_id_chosen_at_idx" ON "employee_avatar_choices"("employee_id", "chosen_at");

-- CreateIndex
CREATE UNIQUE INDEX "employee_avatar_choices_employee_id_idempotency_key_key" ON "employee_avatar_choices"("employee_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "employee_avatar_choices" ADD CONSTRAINT "employee_avatar_choices_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only: never changed or deleted (tests may purge their own fixtures), never truncated.
CREATE TRIGGER employee_avatar_choices_append_only BEFORE UPDATE OR DELETE ON "employee_avatar_choices" FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only();
CREATE TRIGGER employee_avatar_choices_no_truncate BEFORE TRUNCATE ON "employee_avatar_choices" FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only();
-- The chooser is the person themselves.
CREATE OR REPLACE FUNCTION employee_avatar_choices_own() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = NEW."chosen_by_user_id" AND u."employee_id" = NEW."employee_id") THEN
    RAISE EXCEPTION 'AVATAR_OWN_ONLY: only the person chooses their own avatar';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER employee_avatar_choices_own BEFORE INSERT ON "employee_avatar_choices" FOR EACH ROW EXECUTE FUNCTION employee_avatar_choices_own();
