-- FIX-M6 (independent audit 2026-11-20): one director could reset the other's two-step sign-in and unlock them, alone. Both are now director changes the OTHER
-- director confirms (modules/access/directorChanges.ts), and each raises a security alert to the outside mailbox.
ALTER TYPE "DirectorChangeAction" ADD VALUE IF NOT EXISTS 'RESET_2FA';
ALTER TYPE "DirectorChangeAction" ADD VALUE IF NOT EXISTS 'UNLOCK';
