// A-9 G6 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 3): which chip of the search dialog a page belongs to, read from its path.
export type PaletteCategory = "all" | "fav" | "employee" | "payroll" | "leave" | "other";
export const CATEGORY_LABEL: Record<PaletteCategory, string> = { all: "All", fav: "My Favourites", employee: "Employee", payroll: "Payroll", leave: "Leave", other: "Other" };
export function categoryOfPath(path: string): Exclude<PaletteCategory, "all" | "fav"> {
  if (/^\/admin\/payroll(\/|$)/.test(path)) return "payroll";
  if (/^\/admin\/employee(\/|$)/.test(path)) return "employee";
  if (/(^|\/)leave(\/|$)/.test(path)) return "leave";
  return "other";
}

