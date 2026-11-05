-- CreateIndex
CREATE INDEX "candidates_name_hash_idx" ON "candidates"("name_hash");

-- CreateIndex
CREATE INDEX "applications_job_id_status_idx" ON "applications"("job_id", "status");

-- CreateIndex
CREATE INDEX "recruitment_interview_panel_employee_id_active_idx" ON "recruitment_interview_panel"("employee_id", "active");
