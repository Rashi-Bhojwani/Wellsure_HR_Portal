-- M session verification block, AD-07: helpdesk tickets join retention coverage (a third category). Forward-only.
ALTER TABLE "data_erasures" DROP CONSTRAINT "data_erasures_category";
ALTER TABLE "data_erasures" ADD CONSTRAINT "data_erasures_category" CHECK ("category" IN ('CONTACT', 'DOCUMENTS', 'HELPDESK'));
