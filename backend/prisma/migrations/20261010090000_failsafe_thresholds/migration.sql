-- Fail-safe placeholder thresholds (Phase 2, after P2-C review).
--
-- The P2-A placeholder full-day minimum (8h) sat below the General Shift's
-- scheduled work (8h15) by only 15 minutes, so anyone arriving 20 minutes
-- late became a half day: a lateness penalty HR never asked for. A
-- placeholder must fail safe, so until HR confirms real values the
-- thresholds are 6h full day / 3h half day: a clear 2h15 margin below
-- scheduled work. The fields stay marked as placeholders, and
-- finalisation is blocked while they are.
--
-- Touches the row only if nobody has confirmed or changed the values.
UPDATE attendance_policies
SET full_day_min_minutes = 360, half_day_min_minutes = 180, updated_at = now()
WHERE id = 'policy_default'
  AND full_day_min_minutes = 480 AND half_day_min_minutes = 240
  AND placeholder_fields @> '["fullDayMinMinutes","halfDayMinMinutes"]'::jsonb;
