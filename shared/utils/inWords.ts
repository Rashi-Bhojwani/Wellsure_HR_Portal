// An amount of rupees in words, in the Indian convention (crore, lakh, thousand), worked from the decimal string so no float is ever involved.
//   "100000.00"  -> "Rupees One Lakh Only"
//   "99999.50"   -> "Rupees Ninety Nine Thousand Nine Hundred Ninety Nine and Fifty Paise Only"
// Used for the net pay on a payslip. The input is a plain non-negative decimal string ("1234", "1234.5", "1234.50"); more than two decimals is refused, because a
// payslip amount is whole paise.

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? below100(rest) : ""].filter(Boolean).join(" ");
}

/** A whole number (as a digit string) in words, Indian grouping: the last three digits, then pairs (thousand, lakh), and everything above seven digits is crores. */
export function wholeNumberInWords(digits: string): string {
  const clean = digits.replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(clean)) throw new Error("not a whole number");
  if (clean === "0") return "Zero";
  const padded = clean.padStart(7, "0");
  const crore = padded.slice(0, -7) === "" ? "" : padded.slice(0, -7);
  const lakh = Number(padded.slice(-7, -5));
  const thousand = Number(padded.slice(-5, -3));
  const rest = Number(padded.slice(-3));
  const parts: string[] = [];
  if (crore && !/^0+$/.test(crore)) parts.push(`${wholeNumberInWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

export function rupeesInWords(amount: string): string {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) throw new Error(`"${amount}" is not an amount in rupees and paise`);
  const rupees = m[1]!;
  const paise = Number((m[2] ?? "0").padEnd(2, "0"));
  const rupeeWords = /^0+$/.test(rupees) ? "" : wholeNumberInWords(rupees);
  const paiseWords = paise ? below100(paise) : "";
  if (!rupeeWords && !paiseWords) return "Rupees Zero Only";
  return `Rupees ${[rupeeWords, paiseWords ? `${rupeeWords ? "and " : ""}${paiseWords} Paise` : ""].filter(Boolean).join(" ")} Only`;
}
