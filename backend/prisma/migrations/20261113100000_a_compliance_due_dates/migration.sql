-- ST-30 (docs/plans/A_PARITY_ROWS.md part 2): compliance due dates the directors enter themselves (none preset), and the month's marks (done, reminded).
-- A due date is never edited: it is retired and a new one entered. Marks are append-only. The test purge exception applies to both.
CREATE TABLE "compliance_due_dates" (
    "id" TEXT NOT NULL,
    "statute" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "due_day" INTEGER NOT NULL,
    "remind_days_before" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ(3),
    "retired_by_user_id" TEXT,
    "retire_reason" TEXT,
    CONSTRAINT "compliance_due_dates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "compliance_due_dates_day" CHECK ("due_day" BETWEEN 1 AND 31),
    CONSTRAINT "compliance_due_dates_remind" CHECK ("remind_days_before" BETWEEN 0 AND 30),
    CONSTRAINT "compliance_due_dates_texts" CHECK (length("statute") BETWEEN 2 AND 40 AND length("item") BETWEEN 3 AND 200 AND length("source") >= 3)
);
CREATE TABLE "compliance_due_marks" (
    "id" TEXT NOT NULL,
    "due_date_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "by_user_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compliance_due_marks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "compliance_due_marks_kind" CHECK ("kind" IN ('DONE', 'REMINDED')),
    CONSTRAINT "compliance_due_marks_month" CHECK ("month" ~ '^[0-9]{4}-[0-9]{2}$')
);
CREATE UNIQUE INDEX "compliance_due_marks_due_date_id_month_kind_key" ON "compliance_due_marks"("due_date_id", "month", "kind");
ALTER TABLE "compliance_due_marks" ADD CONSTRAINT "compliance_due_marks_due_date_id_fkey" FOREIGN KEY ("due_date_id") REFERENCES "compliance_due_dates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION compliance_due_dates_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL
     AND NEW.statute = OLD.statute AND NEW.item = OLD.item AND NEW.due_day = OLD.due_day AND NEW.remind_days_before = OLD.remind_days_before AND NEW.source = OLD.source
     AND NEW.created_by_user_id = OLD.created_by_user_id AND NEW.created_at = OLD.created_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'COMPLIANCE_DUE_DATE_IMMUTABLE: a due date is only retired, never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER compliance_due_dates_guard BEFORE UPDATE OR DELETE ON "compliance_due_dates" FOR EACH ROW EXECUTE FUNCTION compliance_due_dates_guard();
CREATE FUNCTION compliance_due_marks_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'COMPLIANCE_DUE_MARK_APPEND_ONLY: a mark is never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER compliance_due_marks_guard BEFORE UPDATE OR DELETE ON "compliance_due_marks" FOR EACH ROW EXECUTE FUNCTION compliance_due_marks_append_only();
