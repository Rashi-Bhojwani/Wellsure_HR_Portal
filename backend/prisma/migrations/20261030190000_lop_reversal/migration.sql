-- Stage 3.3b: a loss-of-pay correction for a month whose run is final is one pending adjustment of its own, paid in a later run as a line for each
-- prorated head. Nothing else changes: the idempotency key is the existing unique (source, source_ref).
ALTER TYPE "AdjustmentSource" ADD VALUE IF NOT EXISTS 'LOP_REVERSAL';
ALTER TYPE "PayrollLineSource" ADD VALUE IF NOT EXISTS 'LOP_REVERSAL';
