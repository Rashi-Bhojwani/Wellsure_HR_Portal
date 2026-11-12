import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";

// SYNTHETIC test documents, generated here: fake names and numbers only (every value is labelled DEMO or uses a reserved
// pattern: accounts start 9999, the PAN and IFSC start DEMO, emails use example.invalid). Nothing is read from any real file.
export const BANK = { accountHolderName: "DEMO Person Alpha", accountNumber: "99990000123456", ifsc: "DEMO0123456", bankName: "DEMO Bank", branchName: "DEMO Branch" };
export const IDENTITY = { pan: "DEMOX1234Z", aadhaar: "999900001234" };
export const RESUME = { fullName: "DEMO Person Beta", email: "demo.beta@example.invalid", phone: "+91 90000 22222" };

export async function textPdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 780 - i * 24, size: 14, font }));
  return Buffer.from(await doc.save());
}
export const bankPdf = () => textPdf(["DEMO BANK ACCOUNT LETTER", `Account Holder: ${BANK.accountHolderName}`, `Account Number: ${BANK.accountNumber}`, `IFSC: ${BANK.ifsc}`, `Bank: ${BANK.bankName}`, `Branch: ${BANK.branchName}`]);
export const identityPdf = () => textPdf(["DEMO IDENTITY CARD", "Name: DEMO Person Alpha", `PAN: ${IDENTITY.pan}`, "Aadhaar: 9999 0000 1234"]);
export const resumePdf = () => textPdf([`Name: ${RESUME.fullName}`, `Email: ${RESUME.email}`, `Phone: ${RESUME.phone}`, "DEMO experience: fictional"]);
/** A PDF with no text layer (only drawn shapes): "a scan" with nothing readable. */
export async function blankPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawRectangle({ x: 50, y: 50, width: 200, height: 100 });
  return Buffer.from(await doc.save());
}
/** A clear image of text, for the OCR path. */
export function textPng(lines: string[]): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="${100 + lines.length * 90}"><rect width="100%" height="100%" fill="white"/>${lines.map((l, i) => `<text x="40" y="${100 + i * 90}" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="52" fill="black">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`).join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
/** A poor-quality image: random noise, nothing legible. */
export function noisePng(): Promise<Buffer> {
  let s = 12345;
  const px = Buffer.alloc(400 * 300 * 3);
  for (let i = 0; i < px.length; i++) px[i] = (s = (s * 1103515245 + 12345) >>> 0) >>> 24;
  return sharp(px, { raw: { width: 400, height: 300, channels: 3 } }).png().toBuffer();
}

// A password-protected PDF built by hand (standard security handler, revision 2, RC4 40-bit): the user password is not empty, so
// a reader without the password cannot open it.
const PAD = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
const padPwd = (p: string) => Buffer.concat([Buffer.from(p, "latin1"), PAD]).subarray(0, 32);
function rc4(key: Buffer, data: Buffer) {
  const S = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) { j = (j + S[i]! + key[i % key.length]!) & 255; [S[i], S[j]] = [S[j]!, S[i]!]; }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) { i = (i + 1) & 255; j = (j + S[i]!) & 255; [S[i], S[j]] = [S[j]!, S[i]!]; out[n] = data[n]! ^ S[(S[i]! + S[j]!) & 255]!; }
  return out;
}
export function passwordPdf(userPassword = "DEMO-secret"): Buffer {
  const id = createHash("md5").update("DEMO synthetic").digest();
  const O = rc4(createHash("md5").update(padPwd("DEMO-owner")).digest().subarray(0, 5), padPwd(userPassword));
  const P = -4;
  const p = Buffer.alloc(4); p.writeInt32LE(P);
  const key = createHash("md5").update(Buffer.concat([padPwd(userPassword), O, p, id])).digest().subarray(0, 5);
  const U = rc4(key, PAD);
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>", `<< /Filter /Standard /V 1 /R 2 /O <${O.toString("hex")}> /U <${U.toString("hex")}> /P ${P} >>`];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(body, "latin1")); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
