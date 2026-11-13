-- Stage 6 (docs/plans/STAGE_6_PAYROLL_REPORTS.md): a director's saved column choice for a payroll report. Append-only: the newest row for a report is in force;
-- with none, the report's conventional columns ("Default, change in settings").
CREATE TABLE "payroll_report_layouts" (
  "id" TEXT NOT NULL,
  "report_key" TEXT NOT NULL,
  "columns" TEXT[] NOT NULL,
  "reason" TEXT NOT NULL,
  "set_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_report_layouts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_report_layouts_reason_given" CHECK (length(btrim("reason")) >= 3),
  CONSTRAINT "payroll_report_layouts_some_columns" CHECK (cardinality("columns") >= 1)
);
CREATE INDEX "payroll_report_layouts_report_key_created_at_idx" ON "payroll_report_layouts"("report_key", "created_at");

CREATE OR REPLACE FUNCTION payroll_report_layouts_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'PAYROLL_REPORT_LAYOUT_APPEND_ONLY: a saved report layout is never changed or removed; save a new one';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payroll_report_layouts_append_only" BEFORE UPDATE OR DELETE ON "payroll_report_layouts" FOR EACH ROW EXECUTE FUNCTION payroll_report_layouts_append_only();
