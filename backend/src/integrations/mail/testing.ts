import type { MailReceipt } from "./MailService";

/** A receipt for tests that replace `mailService.send`: the message was "handed over" and nothing real happened. */
export const fakeReceipt = (to = "nobody@example.org"): MailReceipt => ({ driver: "console", delivered: true, to, detail: "test" });
