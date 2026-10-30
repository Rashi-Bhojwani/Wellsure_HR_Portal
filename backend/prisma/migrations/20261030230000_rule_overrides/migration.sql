-- Stage 3.4: department and employee overrides of PF, ESI, PT and LWF parameters are governed items of their own kind (versions, confirmations by a
-- different director, source note, effective-from date), so they use the same append-only tables and database guards as rules, components and structures.
ALTER TYPE "PayrollItemKind" ADD VALUE IF NOT EXISTS 'RULE_OVERRIDE';
