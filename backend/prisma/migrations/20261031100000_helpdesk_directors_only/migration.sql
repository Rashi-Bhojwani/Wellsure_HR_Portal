-- Owner decision: Payroll tickets go to the directors only. A category can be flagged "directors only"; its tickets are read, answered and assigned by directors (the
-- raiser keeps their own thread). The Payroll & Salary category is flagged here, so that nothing HR holds can open its tickets. Only a director can change the flag.
ALTER TABLE "helpdesk_categories" ADD COLUMN "directors_only" BOOLEAN NOT NULL DEFAULT false;
UPDATE "helpdesk_categories" SET "directors_only" = true WHERE "code" = 'PAYROLL_SALARY';

-- A default assignee who is not a director cannot stay on a directors-only category; open tickets assigned to somebody who is not a director are left unassigned
-- (the directors see them in their queue).
UPDATE "helpdesk_categories" c SET "default_assignee_employee_id" = NULL
 WHERE c."directors_only" AND c."default_assignee_employee_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "users" u JOIN "user_roles" ur ON ur."user_id" = u."id" JOIN "roles" r ON r."id" = ur."role_id" WHERE u."employee_id" = c."default_assignee_employee_id" AND r."code" = 'SUPER_ADMIN');
UPDATE "helpdesk_tickets" t SET "assignee_employee_id" = NULL
 WHERE t."status" IN ('OPEN', 'IN_PROGRESS') AND t."assignee_employee_id" IS NOT NULL
   AND t."category_id" IN (SELECT "id" FROM "helpdesk_categories" WHERE "directors_only")
   AND NOT EXISTS (SELECT 1 FROM "users" u JOIN "user_roles" ur ON ur."user_id" = u."id" JOIN "roles" r ON r."id" = ur."role_id" WHERE u."employee_id" = t."assignee_employee_id" AND r."code" = 'SUPER_ADMIN');
