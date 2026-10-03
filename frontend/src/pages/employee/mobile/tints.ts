import type { GlobalToken } from "antd";

// Our own per-area tints for the mobile Action/Explore cards (Phase 5 commit
// G) — from the theme's preset colours, so they work in light and dark mode.
// Keyed by the top-level path segment so an area keeps its colour on both
// tabs; anything new falls back to a rotation.
const AREA: Record<string, keyof GlobalToken> = {
  leave: "cyan",
  attendance: "purple",
  salary: "orange",
  "my-worklife": "green",
  todo: "geekblue",
  people: "magenta",
  helpdesk: "blue",
  "document-center": "gold",
  "request-hub": "volcano",
  "workflow-delegates": "lime",
};
const ROTATION: Array<keyof GlobalToken> = ["blue", "cyan", "orange", "green", "magenta", "purple", "gold", "geekblue"];

export function tintFor(pathOrKey: string, index: number, token: GlobalToken): { fg: string; bg: string } {
  const area = AREA[pathOrKey.split("/")[0]!] ?? ROTATION[index % ROTATION.length]!;
  const fg = String(token[area]);
  return { fg, bg: `${fg}1f` }; // the same hue at ~12% opacity
}
