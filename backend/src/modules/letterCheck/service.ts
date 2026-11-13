import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { formatLetterNumber } from "@shared/constants/letters";

// M session block 2, LT-09: checking an issued letter. Anyone holding a letter (a bank, a landlord, an embassy) uploads the PDF; the server compares
// its SHA-256 with the fingerprint recorded when the letter was generated, and says whether it is a genuine letter of this company, with its
// reference, the template's name, the issue date and the electronic signatures recorded on it (how many, and when). Nothing about the person or
// the signatories is returned: whoever has the letter can already read it, and someone without it learns nothing.

export async function checkLetter(pdf: Buffer) {
  const sha = createHash("sha256").update(pdf).digest("hex");
  const letter = await prisma.generatedLetter.findFirst({ where: { pdfSha256: sha, status: "GENERATED" }, include: { templateVersion: { include: { template: { select: { name: true } } } } } });
  if (!letter) return { genuine: false as const };
  const request = await prisma.letterRequest.findUnique({ where: { generatedLetterId: letter.id }, include: { signatories: { orderBy: { position: "asc" } } } });
  const superseded = await prisma.generatedLetter.count({ where: { reissueOfId: letter.id } });
  return {
    genuine: true as const,
    reference: formatLetterNumber(letter.number),
    letter: letter.templateVersion.template.name,
    issuedOn: letter.generatedAt.toISOString().slice(0, 10),
    replacedByALaterLetter: superseded > 0,
    signatures: (request?.signatories ?? []).filter((s) => s.status === "SIGNED").map((s) => ({ position: s.position, signedOn: s.signedAt?.toISOString().slice(0, 10) ?? null })),
  };
}
