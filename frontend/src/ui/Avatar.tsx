import { fw, radius, v } from "../theme/tokens";

const TONES = [
  { bg: v.chipSuccessBg, fg: v.chipSuccessText },
  { bg: v.chipInfoBg, fg: v.chipInfoText },
  { bg: v.chipPurpleBg, fg: v.chipPurpleText },
  { bg: v.chipWarningBg, fg: v.chipWarningText },
  { bg: v.chipDangerBg, fg: v.chipDangerText },
];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** Initials on a tint picked from the name (the board's "MG" avatars). No photos in fixtures, ever. */
export function InitialsAvatar({ name, size = 40 }: { name: string; size?: number }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const t = TONES[h % TONES.length]!;
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: radius.pill,
        background: t.bg,
        color: t.fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: fw.bold,
        fontSize: Math.max(10, Math.round(size * 0.36)),
        letterSpacing: "0.02em",
        userSelect: "none",
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
