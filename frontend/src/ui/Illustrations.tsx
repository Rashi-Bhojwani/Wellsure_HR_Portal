import type { CSSProperties } from "react";
import { v } from "../theme/tokens";

// Our own line illustrations (docs/DESIGN_SYSTEM.md §6.13): grey outlines with a green accent, drawn from tokens so they follow light and dark. No template artwork.
export type IllustrationName = "empty" | "search" | "error" | "forbidden" | "offline" | "success" | "documents" | "upload" | "calendar" | "inbox" | "chart" | "people";

interface Props {
  name: IllustrationName;
  size?: number;
  style?: CSSProperties;
}

const stroke = { stroke: v.illoLine, strokeWidth: 2, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const accent = { stroke: v.illoAccent, strokeWidth: 2, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function Sparkles() {
  return (
    <g>
      <path d="M22 30l3 3m0-3l-3 3" {...accent} />
      <circle cx="138" cy="28" r="3" fill={v.illoAccentSoft} />
      <path d="M150 70h6m-3-3v6" {...accent} />
      <circle cx="16" cy="78" r="2.5" fill={v.illoLine} />
    </g>
  );
}

function Art({ name }: { name: IllustrationName }) {
  switch (name) {
    case "search":
      return (
        <g>
          <rect x="30" y="34" width="84" height="64" rx="10" fill={v.illoFill} {...{ stroke: v.illoLine, strokeWidth: 2 }} />
          <path d="M44 52h40M44 64h56M44 76h30" {...stroke} />
          <circle cx="112" cy="84" r="20" fill={v.bgSurface} {...{ stroke: v.illoAccent, strokeWidth: 3 }} />
          <path d="M126 98l14 14" stroke={v.illoAccent} strokeWidth="5" strokeLinecap="round" />
          <path d="M104 84h16" {...accent} />
        </g>
      );
    case "error":
      return (
        <g>
          <path d="M44 92a22 22 0 0 1 4-43.6A30 30 0 0 1 106 44a20 20 0 0 1 12 38.6V92z" fill={v.illoFill} {...{ stroke: v.illoLine, strokeWidth: 2 }} />
          <path d="M80 56v18" stroke={v.danger} strokeWidth="4" strokeLinecap="round" />
          <circle cx="80" cy="83" r="2.6" fill={v.danger} />
          <path d="M58 108h44" {...stroke} />
        </g>
      );
    case "forbidden":
      return (
        <g>
          <rect x="50" y="56" width="60" height="48" rx="10" fill={v.illoFill} {...{ stroke: v.illoLine, strokeWidth: 2 }} />
          <path d="M62 56V44a18 18 0 0 1 36 0v12" {...stroke} />
          <circle cx="80" cy="78" r="6" fill={v.illoAccent} />
          <path d="M80 84v8" stroke={v.illoAccent} strokeWidth="4" strokeLinecap="round" />
        </g>
      );
    case "offline":
      return (
        <g>
          <path d="M40 66a56 56 0 0 1 80 0M52 78a38 38 0 0 1 56 0M64 90a20 20 0 0 1 32 0" {...stroke} />
          <circle cx="80" cy="102" r="4" fill={v.illoAccent} />
          <path d="M44 40l72 72" stroke={v.danger} strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    case "success":
      return (
        <g>
          <circle cx="80" cy="64" r="36" fill={v.illoAccentSoft} />
          <circle cx="80" cy="64" r="26" fill={v.illoAccent} />
          <path d="M68 64l8 8 16-16" stroke={v.bgSurface} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M30 40l6 4M128 36l-5 6M34 96l7-3M126 96l-6-4" {...accent} />
          <circle cx="44" cy="22" r="3" fill={v.warning} />
          <circle cx="122" cy="112" r="3" fill={v.info} />
          <path d="M112 18l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill={v.illoAccent} />
        </g>
      );
    case "documents":
      return (
        <g>
          <rect x="46" y="30" width="56" height="72" rx="8" fill={v.illoFill} {...{ stroke: v.illoLine, strokeWidth: 2 }} />
          <rect x="60" y="22" width="56" height="72" rx="8" fill={v.bgSurface} {...{ stroke: v.illoLine, strokeWidth: 2 }} />
          <path d="M72 40h32M72 52h32M72 64h20" {...stroke} />
          <circle cx="110" cy="92" r="14" fill={v.illoAccent} />
          <path d="M104 92h12M110 86v12" stroke={v.bgSurface} strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    case "upload":
      return (
        <g>
          <path d="M38 52h30l8 10h46v44a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6z" fill={v.illoAccent} opacity="0.9" />
          <path d="M38 62h84" stroke={v.bgSurface} strokeWidth="2" opacity="0.5" />
          <path d="M80 98V72m-12 12l12-12 12 12" stroke={v.bgSurface} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="94" y="24" width="22" height="26" rx="3" fill={v.bgSurface} {...{ stroke: v.illoLine, strokeWidth: 2 }} transform="rotate(12 105 37)" />
          <rect x="46" y="22" width="22" height="26" rx="3" fill={v.bgSurface} {...{ stroke: v.illoLine, strokeWidth: 2 }} transform="rotate(-10 57 35)" />
        </g>
      );
    case "calendar":
      return (
        <g>
          <rect x="40" y="34" width="80" height="72" rx="10" fill={v.illoFill} {...{ stroke: v.illoLine, strokeWidth: 2 }} />
          <path d="M40 54h80M60 26v14M100 26v14" {...stroke} />
          <rect x="54" y="64" width="12" height="10" rx="2" fill={v.illoLine} />
          <rect x="74" y="64" width="12" height="10" rx="2" fill={v.illoAccent} />
          <rect x="94" y="64" width="12" height="10" rx="2" fill={v.illoLine} />
          <rect x="54" y="82" width="12" height="10" rx="2" fill={v.illoLine} />
          <rect x="74" y="82" width="12" height="10" rx="2" fill={v.illoLine} />
        </g>
      );
    case "inbox":
      return (
        <g>
          <path d="M36 70l14-30h60l14 30v28a8 8 0 0 1-8 8H44a8 8 0 0 1-8-8z" fill={v.illoFill} {...{ stroke: v.illoLine, strokeWidth: 2 }} />
          <path d="M36 70h26l6 10h24l6-10h26" {...stroke} />
          <path d="M68 52l8 8 16-16" {...accent} strokeWidth="3" />
        </g>
      );
    case "chart":
      return (
        <g>
          <rect x="36" y="30" width="88" height="76" rx="10" fill={v.illoFill} {...{ stroke: v.illoLine, strokeWidth: 2 }} />
          <rect x="52" y="70" width="12" height="24" rx="3" fill={v.illoLine} />
          <rect x="74" y="54" width="12" height="40" rx="3" fill={v.illoAccent} />
          <rect x="96" y="62" width="12" height="32" rx="3" fill={v.illoLine} />
        </g>
      );
    case "people":
      return (
        <g>
          <circle cx="62" cy="54" r="14" fill={v.illoFill} {...{ stroke: v.illoLine, strokeWidth: 2 }} />
          <path d="M38 100a24 24 0 0 1 48 0" fill={v.illoFill} {...{ stroke: v.illoLine, strokeWidth: 2 }} />
          <circle cx="100" cy="50" r="12" fill={v.illoAccentSoft} {...{ stroke: v.illoAccent, strokeWidth: 2 }} />
          <path d="M80 96a20 20 0 0 1 40 0" fill={v.illoAccentSoft} {...{ stroke: v.illoAccent, strokeWidth: 2 }} />
        </g>
      );
    case "empty":
    default:
      return (
        <g>
          <rect x="38" y="44" width="84" height="60" rx="10" fill={v.illoFill} {...{ stroke: v.illoLine, strokeWidth: 2 }} />
          <path d="M38 66h28l6 10h16l6-10h28" {...stroke} />
          <path d="M60 30l6 8M80 24v10M100 30l-6 8" {...accent} />
        </g>
      );
  }
}

export function Illustration({ name, size = 140, style }: Props) {
  return (
    <svg width={size} height={(size * 128) / 160} viewBox="0 0 160 128" role="img" aria-hidden="true" focusable="false" style={{ display: "block", ...style }}>
      <ellipse cx="80" cy="118" rx="52" ry="6" fill={v.illoFill} />
      {name !== "success" && <Sparkles />}
      <Art name={name} />
    </svg>
  );
}
