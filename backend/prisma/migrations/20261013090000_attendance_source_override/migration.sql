-- Phase 3 commit 1: a day corrected by hand (a regularization or a manual override)
-- has its own source, so it is never mistaken for a device-derived day. Its own
-- migration because a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "AttendanceSource" ADD VALUE IF NOT EXISTS 'OVERRIDE';
