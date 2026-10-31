// Slot times are shown in the company's timezone (as lib/dates.ts does for dates), whatever the viewer's browser says.
const TZ = "Asia/Kolkata";
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: TZ });

/** "Sat, 1 Nov, 10:00 am – 10:30 am" in IST. */
export const slotTime = (s: { startsAt: string; endsAt: string }) => `${dayTime(s.startsAt)} – ${time(s.endsAt)}`;
