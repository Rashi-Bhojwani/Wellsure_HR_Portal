import { describe, expect, it } from "vitest";
import type { LetterExtraField } from "@shared/constants/letters";
import { LETTER_TEMPLATE_SEEDS } from "../../../../prisma/seedLetterTemplates";
import { mergeIntoBody, sanitizeTemplateHtml, validateExtraFields, validatePlaceholders } from "../template";

const CTC: LetterExtraField = { key: "ctcAnnual", label: "CTC", type: "currency", required: true };

describe("letter templates — sanitizing, placeholders, escaping", () => {
  it("strips anything that isn't formatting: scripts, handlers, images, links, iframes, arbitrary styles", () => {
    const dirty = `<p style="text-align: center; color: red; background:url(http://x)" onclick="alert(1)">Hi</p><script>alert(1)</script><img src="http://169.254.169.254/" onerror="x()"><a href="http://evil">link</a><iframe src="http://x"></iframe><h2 style="text-align: right">Title</h2><strong>b</strong><em>i</em><u>u</u><ul><li>x</li></ul>`;
    const clean = sanitizeTemplateHtml(dirty);
    expect(clean).not.toMatch(/script|onclick|onerror|<img|<a |iframe|color|background|169\.254/);
    expect(clean).toContain('<p style="text-align:center">Hi</p>');
    expect(clean).toContain('<h2 style="text-align:right">Title</h2>');
    expect(clean).toContain("link"); // the link's text survives, the link doesn't
    expect(clean).toContain("<strong>b</strong><em>i</em><u>u</u><ul><li>x</li></ul>");
  });

  it("accepts catalog placeholders and the version's own typed fields", () => {
    expect(() => validatePlaceholders("<p>{{employee.fullName}} {{ letter.date }} {{extra.ctcAnnual}}</p>", [CTC])).not.toThrow();
  });

  it("refuses an unknown placeholder, and an extra field the version doesn't define", () => {
    expect(() => validatePlaceholders("<p>{{employee.salary}}</p>", [])).toThrow(/Unknown placeholder: \{\{employee\.salary\}\}/);
    expect(() => validatePlaceholders("<p>{{extra.ctcAnnual}}</p>", [])).toThrow(/Unknown placeholder/);
  });

  it("refuses a placeholder broken up by formatting, or a stray brace — it would print literally on a legal document", () => {
    expect(() => validatePlaceholders("<p>{{employee.<strong>fullName</strong>}}</p>", [])).toThrow(/broken up by formatting/);
    expect(() => validatePlaceholders("<p>Dear {{employee.fullName}</p>", [])).toThrow(/broken up by formatting/);
    expect(() => validatePlaceholders("<p>Total }} here</p>", [])).toThrow(/broken up by formatting/);
  });

  it("validates typed-field keys", () => {
    expect(() => validateExtraFields([{ ...CTC, key: "1bad" }])).toThrow(/letters and digits/);
    expect(() => validateExtraFields([CTC, CTC])).toThrow(/used twice/);
  });

  it("merges values as escaped plain text, keeping line breaks", () => {
    const out = mergeIntoBody("<p>{{employee.fullName}}</p><p>{{employee.currentAddress}}</p><p>{{extra.note}}</p>", {
      "employee.fullName": "Arjun <b>Singh</b>",
      "employee.currentAddress": "12 MG Road\nAjmer",
      "extra.note": `"quoted" & <script>alert(1)</script>`,
    });
    expect(out).toBe("<p>Arjun &lt;b&gt;Singh&lt;/b&gt;</p><p>12 MG Road<br>Ajmer</p><p>&quot;quoted&quot; &amp; &lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("every seeded template passes the same sanitizer and validation as an HR edit, unchanged", () => {
    expect(LETTER_TEMPLATE_SEEDS.map((t) => t.code).sort()).toEqual(["ADDRESS_PROOF", "APPOINTMENT", "EXPERIENCE", "OFFER", "RELIEVING"]);
    for (const t of LETTER_TEMPLATE_SEEDS) {
      expect(sanitizeTemplateHtml(t.bodyHtml), t.code).toBe(t.bodyHtml);
      expect(() => validateExtraFields(t.extraFields), t.code).not.toThrow();
      expect(() => validatePlaceholders(t.bodyHtml, t.extraFields), t.code).not.toThrow();
    }
  });
});
