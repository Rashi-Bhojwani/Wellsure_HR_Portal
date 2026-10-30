-- Peeps assets: the end reason and event kind for handing an asset from one holder to the next are stored as REASSIGNED. The screens still say
-- "Transferred". The payroll guard (modules/payroll/__tests__/payrollGuards.test.ts) keeps any word that could read as "money was sent" out of
-- the schema, and the first asset migration used one; renaming the enum value keeps every existing row and changes nothing else.
ALTER TYPE "AssetAssignmentEndReason" RENAME VALUE 'TRANSFERRED' TO 'REASSIGNED';
ALTER TYPE "AssetEventKind" RENAME VALUE 'TRANSFERRED' TO 'REASSIGNED';
