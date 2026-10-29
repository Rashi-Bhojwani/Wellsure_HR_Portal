import type { ReactNode } from "react";
import { Button, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { fs, fw, space, v } from "../theme/tokens";
import { Illustration, type IllustrationName } from "./Illustrations";

const { Text } = Typography;

export type EmptyKind = "empty" | "no-results" | "error" | "forbidden" | "offline";

const DEFAULTS: Record<EmptyKind, { illo: IllustrationName; title: string; description: string }> = {
  empty: { illo: "empty", title: "Nothing here yet", description: "When there is something to show, it will appear here." },
  "no-results": { illo: "search", title: "No matches", description: "Try a different search or clear the filters." },
  error: { illo: "error", title: "Something went wrong", description: "We couldn't load this. Check your connection and try again." },
  forbidden: { illo: "forbidden", title: "You don't have access", description: "Ask an administrator if you need to see this." },
  offline: { illo: "offline", title: "Can't reach the server", description: "You seem to be offline. This page will work again once you're connected." },
};

export interface EmptyStateProps {
  kind?: EmptyKind;
  title?: ReactNode;
  /** `null` hides the sentence. */
  description?: ReactNode | null;
  illustration?: IllustrationName | false;
  /** Primary call to action (a Button), or extra content. */
  action?: ReactNode;
  /** Shows a "Try again" button (error / offline). */
  onRetry?: () => void;
  /** Smaller, for cards that share a row with other cards. */
  compact?: boolean;
}

// The board's empty state (documents-02, news-05): our own line illustration, a bold title, one sentence, an optional action. One component for empty, no results,
// error, forbidden and offline, so every screen says these things the same way (DESIGN_SYSTEM.md §6.13).
export function EmptyState({ kind = "empty", title, description, illustration, action, onRetry, compact = false }: EmptyStateProps) {
  const d = DEFAULTS[kind];
  const illo = illustration === false ? null : (illustration ?? d.illo);
  return (
    <div
      role={kind === "error" || kind === "offline" ? "alert" : "status"}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: compact ? space[2] : space[3], padding: compact ? `${space[4]}px ${space[3]}px` : `${space[10]}px ${space[4]}px` }}
    >
      {illo && <Illustration name={illo} size={compact ? 96 : 150} />}
      <div style={{ fontSize: compact ? fs.lg : fs.h2, fontWeight: fw.bold, color: v.textPrimary, lineHeight: 1.3 }}>{title ?? d.title}</div>
      {description !== null && (
        <Text type="secondary" style={{ maxWidth: 420, fontSize: compact ? fs.sm : fs.md }}>
          {description === undefined ? d.description : description}
        </Text>
      )}
      {(action || onRetry) && (
        <div style={{ marginTop: space[2], display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: "center" }}>
          {onRetry && (
            <Button icon={<ReloadOutlined />} onClick={onRetry}>
              Try again
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
