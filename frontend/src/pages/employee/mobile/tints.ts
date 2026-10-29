import { v } from "../../../theme/tokens";

// Our own per-area tints for the mobile Action/Explore cards (Phase 5 commit G; UI pass): pairs of design-system tokens (the attendance-day
// tint pairs, AA-checked and dark-adapted), so they follow light and dark. Keyed by the top-level path segment so an area keeps its colour
// on both tabs (UI_REFERENCE PART 4: lavender attendance, teal leave, peach salary); anything new falls back to a rotation.
export interface Tint {
  fg: string;
  bg: string;
}

const T = {
  green: { bg: v.attPBg, fg: v.attPFg },
  blue: { bg: v.attHBg, fg: v.attHFg },
  purple: { bg: v.attLBg, fg: v.attLFg },
  yellow: { bg: v.attHdBg, fg: v.attHdFg },
  pink: { bg: v.attABg, fg: v.attAFg },
  neutral: { bg: v.attOBg, fg: v.attOFg },
} satisfies Record<string, Tint>;

const AREA: Record<string, Tint> = {
  leave: T.green,
  attendance: T.purple,
  salary: T.yellow,
  "my-worklife": T.green,
  todo: T.blue,
  people: T.pink,
  helpdesk: T.blue,
  "document-center": T.yellow,
  "request-hub": T.purple,
  "workflow-delegates": T.neutral,
};
const ROTATION: Tint[] = [T.blue, T.green, T.yellow, T.purple, T.pink, T.neutral];

export function tintFor(pathOrKey: string, index: number): Tint {
  return AREA[pathOrKey.split("/")[0]!] ?? ROTATION[index % ROTATION.length]!;
}
