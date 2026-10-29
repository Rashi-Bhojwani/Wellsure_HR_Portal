import { fw, radius, v } from "../theme/tokens";
import { initialsOf } from "./avatarUtils";

const TONES = [
  { bg: v.chipSuccessBg, fg: v.chipSuccessText },
  { bg: v.chipInfoBg, fg: v.chipInfoText },
  { bg: v.chipPurpleBg, fg: v.chipPurpleText },
  { bg: v.chipWarningBg, fg: v.chipWarningText },
  { bg: v.chipDangerBg, fg: v.chipDangerText },
];

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
