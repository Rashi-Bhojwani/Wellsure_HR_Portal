-- ST-08 (docs/plans/A_PARITY_ROWS.md part 2): the challan register also records PT and LWF deposits. Only the allowed kinds widen; nothing else changes.
ALTER TABLE "statutory_challans" DROP CONSTRAINT "statutory_challans_kind";
ALTER TABLE "statutory_challans" ADD CONSTRAINT "statutory_challans_kind" CHECK ("kind" IN ('PF', 'ESI', 'PT', 'LWF'));
