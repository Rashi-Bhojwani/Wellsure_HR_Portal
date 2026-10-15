-- Phase 3 commit 2: an override that changes nothing about the day's figures — HR released approved leave because the
-- person worked, and the day follows the device's own punches. In its own migration because Postgres cannot use a new
-- enum value in the transaction that adds it (the next migration's check constraint uses it).
ALTER TYPE "OverrideKind" ADD VALUE IF NOT EXISTS 'RELEASE_ONLY';
