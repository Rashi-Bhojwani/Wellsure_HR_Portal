// The Setup Checklist and the "Ready for first real run" screen (docs/plans/PHASE_6.md §14J). Both are views of one report, computed from the data each time it is asked for.

export type SetupStatus = "NOT_SET" | "PLACEHOLDER" | "CONFIRMED";
export type SectionId = "identifiers" | "law" | "company" | "salary" | "bank" | "files" | "people" | "safety";

export interface Person {
  name: string;
  at: string;
}

export interface SetupItem {
  id: string;
  section: SectionId;
  /** A smaller heading inside the section (a rule's group). */
  category?: string;
  /** In words an owner understands. */
  title: string;
  why: string;
  required: boolean;
  notRequiredReason?: string;
  status: SetupStatus;
  enteredBy: Person | null;
  confirmedBy: Person | null;
  /** One line saying where it stands. */
  detail: string;
  /** Where it is entered. */
  where: { label: string; path: string };
  /** Which permission is needed to enter or confirm it, when that is not the usual one. */
  permissionNote?: string;
  /** Something that should be impossible but is true: a value confirmed by the person who entered it, a developer who can see a secret. */
  problem?: string;
  /** For people's data: how many are covered, and the first few who are not. */
  coverage?: { covered: number; total: number; missing: Array<{ employeeId: string; code: string; name: string }> };
  /** For people's data: the area a sign-off can be given for. */
  signoffArea?: "SALARIES" | "BANK_ACCOUNTS" | "STATUTORY_IDS";
  /** An open question that stops this being confirmed. */
  question?: string;
}

export interface SetupSection {
  id: SectionId;
  title: string;
  intro: string;
  items: SetupItem[];
}

export interface SetupReport {
  generatedAt: string;
  environment: string;
  /** This is the demo company: fake people and figures. Green here means the demo is complete, not that a real company is ready. */
  demo: boolean;
  sections: SetupSection[];
}

export interface Blocker {
  itemId: string;
  section: SectionId;
  sectionTitle: string;
  title: string;
  status: SetupStatus;
  /** Exactly what is missing, in words. */
  missing: string;
  where: { label: string; path: string };
}

export interface Readiness {
  ready: boolean;
  demo: boolean;
  generatedAt: string;
  required: number;
  confirmed: number;
  blockers: Blocker[];
  /** Shown, not blocking. */
  notRequiredYet: Array<{ itemId: string; title: string; status: SetupStatus; reason: string }>;
}
