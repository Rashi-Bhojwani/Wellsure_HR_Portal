// Dates are shown in the company's timezone (Asia/Kolkata), whatever the
// viewer's browser is set to — "closes automatically on 8 Oct" must mean the
// same day for everyone.
const TZ = "Asia/Kolkata";

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: TZ });
}
