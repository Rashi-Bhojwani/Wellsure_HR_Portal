import { describe, expect, it } from "vitest";
import type { LetterExtraField } from "@shared/constants/letters";
import { payFreeProof, payFreeValueProblem } from "../template";

// The proof that a letter cannot carry a pay figure (what lets HR issue it without the directors' Issue letters key). Conservative: a false refusal sends a letter to a director; a false
// pass would leak pay, so every way a figure could get in is covered here and refused.

const text = (key: string, label = key): LetterExtraField => ({ key, label, type: "text", required: false });
const BODY = "<p>Dear {{employee.fullName}} ({{employee.code}}), this confirms your employment as {{employee.designation}} from {{employee.dateOfJoining}}.</p><p>{{signatory.name}}</p>";

describe("a letter that cannot carry a pay figure", () => {
  it("is proven pay-free: the closed placeholders only, text fields with ordinary names, no pay word in the fixed text", () => {
    expect(payFreeProof(BODY, [])).toEqual({ ok: true, reasons: [] });
    expect(payFreeProof(BODY + "<p>Addressed to {{extra.addressedTo}}.</p>", [text("addressedTo", "Addressed to")]).ok).toBe(true);
  });

  it.each([
    ["a currency field", [{ key: "ctc", label: "Annual CTC", type: "currency", required: true }] as LetterExtraField[], BODY],
    ["a number field", [{ key: "days", label: "Days", type: "number", required: false }] as LetterExtraField[], BODY],
    ["a text field called CTC", [text("ctc", "Annual package")], BODY],
    ["a text field labelled salary", [text("notes", "Salary details")], BODY],
    ["a field called stipend", [text("stipend")], BODY],
    ["a field called remuneration", [text("x", "Remuneration")], BODY],
    ["the word salary in the text", [], BODY + "<p>Your salary will be discussed.</p>"],
    ["the word CTC", [], BODY + "<p>Your CTC is confidential.</p>"],
    ["a rupee sign", [], BODY + "<p>₹ 5</p>"],
    ["Rs.", [], BODY + "<p>Rs. 5</p>"],
    ["per annum", [], BODY + "<p>10 per annum</p>"],
    ["lakh", [], BODY + "<p>12 lakh</p>"],
    ["an amount written with commas", [], BODY + "<p>1,20,000</p>"],
    ["a bonus", [], BODY + "<p>a joining bonus</p>"],
    ["an unknown placeholder", [], BODY + "<p>{{employee.salary}}</p>"],
  ])("is refused with a reason: %s", (_n, fields, body) => {
    const r = payFreeProof(body, fields);
    expect(r.ok).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("a pay word hidden by formatting is still found", () => {
    expect(payFreeProof(BODY + "<p>Your <strong>sal</strong><strong>ary</strong> is fixed.</p>", []).ok).toBe(false);
  });

  it("what is typed into a text field is checked too", () => {
    for (const bad of ["₹ 5,00,000", "Rs 500000", "CTC 12 LPA", "salary 40000", "10,00,000", "twelve lakh", "bonus"]) expect(payFreeValueProblem("Notes", bad), bad).not.toBeNull();
    for (const ok of ["The Branch Manager", "Block C-10, Panchsheel Park", "3 months", ""]) expect(payFreeValueProblem("Notes", ok), ok).toBeNull();
  });
});
