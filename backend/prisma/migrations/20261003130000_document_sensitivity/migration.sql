-- Document categories carry a sensitivity (user decision 2026-10-03): any
-- category that can contain money figures is never visible to a manager,
-- structurally, like bank and statutory data. See schema.prisma.
CREATE TYPE "DocumentSensitivity" AS ENUM ('GENERAL', 'PAY', 'STATUTORY');

-- Unknown contents default to the restrictive PAY.
ALTER TABLE "document_categories" ADD COLUMN "sensitivity" "DocumentSensitivity" NOT NULL DEFAULT 'PAY';

-- Company documents are published to everyone.
UPDATE "document_categories" SET "sensitivity" = 'GENERAL' WHERE "applies_to" = 'COMPANY';
-- ID proofs carry PAN/Aadhaar: the statutory bar.
UPDATE "document_categories" SET "sensitivity" = 'STATUTORY' WHERE "code" = 'ID_PROOFS';
-- LETTERS (where every issued letter is filed) and every other employee
-- category stay PAY.

-- documents.pay.view: HR_ADMIN and PAYROLL_ADMIN (salary stays off
-- HR_EXECUTIVE and managers, spec §2). Applied here once because
-- ensureAccessCatalog() never edits an existing role.
INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid()::text, 'documents.pay.view', 'Pay documents'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."key" = 'documents.pay.view');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'documents.pay.view'
WHERE r."code" IN ('HR_ADMIN', 'PAYROLL_ADMIN')
ON CONFLICT DO NOTHING;
