// Generates a small but genuinely valid single-page PDF (correct xref
// offsets, opens in any viewer) — for the seed's demo documents and for
// tests that upload a real PDF. Dev/test data only; never used to render
// anything a user asked for (real letter generation is a later commit).
export function minimalPdf(title: string, lines: string[] = []): Buffer {
  const escape = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "?");
  const text = [
    "BT /F1 18 Tf 72 740 Td",
    `(${escape(title)}) Tj`,
    "/F1 11 Tf",
    ...lines.map((l) => `0 -22 Td (${escape(l)}) Tj`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
