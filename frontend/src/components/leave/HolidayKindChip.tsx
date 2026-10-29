import { StatusChip } from "../../ui";

export type HolidayKind = "HOLIDAY" | "RESTRICTED";

/** "Holiday" (company-wide, everyone off) vs "Restricted" (optional, taken from the RH quota) — a word, never colour alone. */
export function HolidayKindChip({ kind }: { kind: HolidayKind }) {
  return <StatusChip tone={kind === "HOLIDAY" ? "success" : "purple"}>{kind === "HOLIDAY" ? "Holiday" : "Restricted"}</StatusChip>;
}
