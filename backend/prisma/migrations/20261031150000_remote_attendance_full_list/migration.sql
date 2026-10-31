-- Remote attendance, the full list: a half day needs a reason as well as a rejection does; an approval may carry an optional note (kept in the same column).
ALTER TABLE "remote_attendance_records" DROP CONSTRAINT "remote_attendance_records_decision_check";
ALTER TABLE "remote_attendance_records" ADD CONSTRAINT "remote_attendance_records_decision_check" CHECK (
  ("status" <> 'REJECTED' OR ("decision_reason" IS NOT NULL AND length(btrim("decision_reason")) >= 3 AND "reject_outcome" IS NOT NULL))
  AND ("status" <> 'APPROVED_HALF' OR ("half" IS NOT NULL AND "decision_reason" IS NOT NULL AND length(btrim("decision_reason")) >= 3))
  AND ("check_out_at" IS NULL OR "check_in_at" IS NOT NULL AND "check_out_at" >= "check_in_at")
);
