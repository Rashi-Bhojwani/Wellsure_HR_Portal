-- M session block 2, SS-13: employee feedback and suggestions to HR. Anonymous feedback stores no author at all (author_employee_id NULL), so it
-- cannot be traced back and cannot be answered. Forward-only.
CREATE TABLE "employee_feedback" (
  "id" TEXT NOT NULL,
  "author_employee_id" TEXT,
  "category" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "closed_by_user_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_feedback_category" CHECK ("category" IN ('SUGGESTION', 'APPRECIATION', 'CONCERN', 'OTHER')),
  CONSTRAINT "employee_feedback_status" CHECK ("status" IN ('OPEN', 'CLOSED')),
  CONSTRAINT "employee_feedback_message_given" CHECK (length(btrim("message")) >= 5)
);
CREATE INDEX "employee_feedback_author_employee_id_idx" ON "employee_feedback"("author_employee_id");
CREATE INDEX "employee_feedback_status_created_at_idx" ON "employee_feedback"("status", "created_at");
ALTER TABLE "employee_feedback" ADD CONSTRAINT "employee_feedback_author_employee_id_fkey" FOREIGN KEY ("author_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "employee_feedback_replies" (
  "id" TEXT NOT NULL,
  "feedback_id" TEXT NOT NULL,
  "author_user_id" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_feedback_replies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_feedback_replies_message_given" CHECK (length(btrim("message")) >= 2)
);
CREATE INDEX "employee_feedback_replies_feedback_id_idx" ON "employee_feedback_replies"("feedback_id");
ALTER TABLE "employee_feedback_replies" ADD CONSTRAINT "employee_feedback_replies_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "employee_feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
