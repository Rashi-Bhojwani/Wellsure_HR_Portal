-- D2 (docs/plans/DIRECTOR_AUTHORITY.md §4.6): a setup sign-off records the mode it was given under. A sign-off by a director who entered some of the rows themselves is
-- DIRECTOR_AUTHORITY (the other director is told); every earlier row, and every sign-off by a different person, is SECOND_DIRECTOR. Adding a column does not touch what the
-- append-only trigger protects.
ALTER TABLE "payroll_setup_signoffs" ADD COLUMN "authority" "ApprovalAuthority" NOT NULL DEFAULT 'SECOND_DIRECTOR';
