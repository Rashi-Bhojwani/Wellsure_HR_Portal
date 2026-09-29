-- AddForeignKey
ALTER TABLE "year_end_run_items" ADD CONSTRAINT "year_end_run_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
