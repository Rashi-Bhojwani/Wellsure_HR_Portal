-- ST-25 (docs/plans/A_PARITY_ROWS.md part 2): each person's Form 16 Part A for a closed year, uploaded by a director as the tax portal issued it. Nothing is read
-- from the file. Append-only: a corrected Part A is a new row (the newest is the one served).
CREATE TABLE "form16_part_a_files" (
    "id" TEXT NOT NULL,
    "financial_year" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "form16_part_a_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "form16_part_a_files_year" CHECK ("financial_year" ~ '^[0-9]{4}-[0-9]{2}$')
);
CREATE INDEX "form16_part_a_files_year_employee_idx" ON "form16_part_a_files"("financial_year", "employee_id", "created_at");
CREATE FUNCTION form16_part_a_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'FORM16_PART_A_APPEND_ONLY: an uploaded Part A is never changed or deleted; upload a corrected one';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER form16_part_a_files_guard BEFORE UPDATE OR DELETE ON "form16_part_a_files" FOR EACH ROW EXECUTE FUNCTION form16_part_a_append_only();
