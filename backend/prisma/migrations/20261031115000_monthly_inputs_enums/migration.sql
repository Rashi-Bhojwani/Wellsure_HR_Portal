-- Stage 4: a month's Monthly Inputs are confirmed by a second director (an approval subject of its own), and a confirmed figure is a line of the run.
-- Separate from the tables so the new values are committed before anything uses them.
ALTER TYPE "PayrollApprovalSubject" ADD VALUE IF NOT EXISTS 'MONTHLY_INPUTS';
ALTER TYPE "PayrollLineSource" ADD VALUE IF NOT EXISTS 'MONTHLY_INPUT';
