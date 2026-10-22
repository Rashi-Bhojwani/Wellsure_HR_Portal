import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BEGIN, END, sensitiveMarkdown } from "../sensitiveDocs";

describe("docs/SENSITIVE_DATA.md says what the code does", () => {
  it("its generated tables are exactly what the registry and the default roles produce", () => {
    const doc = readFileSync(path.resolve(__dirname, "../../../../docs/SENSITIVE_DATA.md"), "utf8");
    const start = doc.indexOf(BEGIN);
    const end = doc.indexOf(END);
    expect(start, "the BEGIN marker is missing").toBeGreaterThanOrEqual(0);
    expect(end, "the END marker is missing").toBeGreaterThan(start);
    expect(doc.slice(start, end + END.length), "run `npm run docs:sensitive --prefix backend` and paste the output between the markers").toBe(sensitiveMarkdown());
  });
});
