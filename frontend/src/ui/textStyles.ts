import type { CSSProperties } from "react";

// Long free text in a table cell (a claim's description, a settlement line's source): wraps inside its column instead of widening the table.
// DataTable scrolls on `max-content`, so a free-text column also gets a width; with this style the text wraps within it, long words included.
export const WRAP_TEXT: CSSProperties = { whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" };
