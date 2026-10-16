// Rendering an exact decimal string from the payroll API as rupees, with Indian digit grouping (12,34,567.50). Done on the text itself: the amount is never
// turned into a JavaScript number, so what is shown is exactly what is stored.

export function formatRupees(amount: string, minFraction = 0): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return amount;
  const [, sign, whole, frac = ""] = m;
  const last3 = whole!.slice(-3);
  const rest = whole!.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  const fraction = frac.length >= minFraction ? frac : frac.padEnd(minFraction, "0");
  return `${sign}₹${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** "+₹4,000" / "-₹2,000" / "₹0", for a difference. */
export function formatDifference(amount: string): string {
  if (/^-?0(\.0+)?$/.test(amount)) return formatRupees("0");
  return amount.startsWith("-") ? formatRupees(amount) : `+${formatRupees(amount)}`;
}
