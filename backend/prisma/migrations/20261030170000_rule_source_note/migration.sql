-- No CA: the owners enter and verify every statutory and tax value. A rule version carries a SOURCE NOTE (where the number came from) and an effective-from date; a different director confirms it.
ALTER TABLE "payroll_item_versions" ADD COLUMN "source_note" TEXT NOT NULL DEFAULT '';
ALTER TABLE "payroll_item_versions" ADD COLUMN "effective_from" DATE;
