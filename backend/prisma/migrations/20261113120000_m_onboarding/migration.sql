-- M session block 2, OE-04: a new joiner's onboarding steps, copied from the checklist (policy.onboarding) when onboarding starts, so a later change
-- to the checklist does not rewrite anyone's steps. Forward-only.
CREATE TABLE "onboarding_tasks" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "owner" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "due_date" DATE NOT NULL,
  "done_at" TIMESTAMPTZ(3),
  "done_by_user_id" TEXT,
  "started_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "onboarding_tasks_owner" CHECK ("owner" IN ('HR', 'MANAGER', 'EMPLOYEE')),
  CONSTRAINT "onboarding_tasks_done_by" CHECK (("done_at" IS NULL) = ("done_by_user_id" IS NULL))
);
CREATE UNIQUE INDEX "onboarding_tasks_employee_id_position_key" ON "onboarding_tasks"("employee_id", "position");
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
