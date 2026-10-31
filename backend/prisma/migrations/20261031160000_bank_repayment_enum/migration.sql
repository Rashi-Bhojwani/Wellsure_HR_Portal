-- Stage 5b: a repayment of rejected bank rows is approved like a bank file (its own approval subject, the same director step). Separate so the value is committed before use.
ALTER TYPE "PayrollApprovalSubject" ADD VALUE IF NOT EXISTS 'BANK_REPAYMENT';
