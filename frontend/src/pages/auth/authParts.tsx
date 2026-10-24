import type { ReactNode } from "react";
import { Alert } from "antd";
import { CheckCircleFilled, CloseCircleFilled, MinusCircleOutlined } from "@ant-design/icons";
import { fs, fw, space, v } from "../../theme/tokens";

// Small pieces shared by the auth pages (board auth-01..09).

/** The board's required mark: a red asterisk after the label (antd's default puts it before). */
export function requiredMark(label: ReactNode, { required }: { required: boolean }): ReactNode {
  return (
    <span style={{ fontWeight: fw.medium }}>
      {label}
      {required && (
        <span aria-hidden style={{ color: v.danger, marginLeft: 4 }}>
          *
        </span>
      )}
    </span>
  );
}

/** Error banner above the form (honest messages: e.g. "The server can't be reached…" from lib/apiError). */
export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Alert type="error" showIcon title={message} role="alert" style={{ marginBottom: space[5] }} />;
}

// The rules the backend enforces for a new password (backend/src/modules/auth/validators.ts — passwordSchema), as the board's
// checklist (auth-07). Informational only: the server still validates and its message is shown if it refuses.
const RULES: { key: string; label: string; test: (p: string) => boolean }[] = [
  { key: "len", label: "At least 8 characters", test: (p) => p.length >= 8 },
  { key: "num", label: "A number (0-9)", test: (p) => /[0-9]/.test(p) },
  { key: "upper", label: "An uppercase letter (A-Z)", test: (p) => /[A-Z]/.test(p) },
  { key: "lower", label: "A lowercase letter (a-z)", test: (p) => /[a-z]/.test(p) },
];

export function PasswordRules({ value }: { value: string | undefined }) {
  const pw = value ?? "";
  const touched = pw.length > 0;
  return (
    <ul
      aria-label="Password requirements"
      style={{ listStyle: "none", margin: `${space[2]}px 0 0`, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(180px, 100%), 1fr))", gap: `${space[1]}px ${space[4]}px` }}
    >
      {RULES.map((r) => {
        const ok = r.test(pw);
        const color = !touched ? v.textSecondary : ok ? v.chipSuccessText : v.danger;
        const Icon = !touched ? MinusCircleOutlined : ok ? CheckCircleFilled : CloseCircleFilled;
        return (
          <li key={r.key} style={{ display: "flex", alignItems: "center", gap: space[2], fontSize: fs.sm, color }}>
            <Icon aria-hidden />
            <span>
              {r.label}
              {touched && <span className="ws-sr-only">{ok ? " — met" : " — not met yet"}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
