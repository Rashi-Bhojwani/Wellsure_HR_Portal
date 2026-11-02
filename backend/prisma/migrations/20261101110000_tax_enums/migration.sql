-- Stage 7 (P7-2, P7-3): a tax year is a governed item, and income tax deducted in a run is a line of its own. Enum values only: nothing may use them in this migration.
ALTER TYPE "PayrollItemKind" ADD VALUE IF NOT EXISTS 'TAX_YEAR';
ALTER TYPE "PayrollLineSource" ADD VALUE IF NOT EXISTS 'TDS';
