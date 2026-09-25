import { Card, Typography } from "antd";
import type { ReactNode } from "react";

const { Title, Text } = Typography;

interface AuthShellProps {
  title: string;
  subtitle?: string;
  width?: number;
  children: ReactNode;
}

// Shared shell for every auth page (login, set/forgot/reset password, 2FA
// challenge/enrolment) — centred card, logo placeholder, title/subtitle.
export function AuthShell({ title, subtitle, width = 380, children }: AuthShellProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f4f5f7",
        padding: 16,
      }}
    >
      <Card style={{ width, maxWidth: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          {/* Logo placeholder — replace with the real Wellsure logo */}
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: "#2f6fed",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 24,
              margin: "0 auto 16px",
            }}
          >
            W
          </div>
          <Title level={3} style={{ margin: 0 }}>
            {title}
          </Title>
          {subtitle && <Text type="secondary">{subtitle}</Text>}
        </div>
        {children}
      </Card>
    </div>
  );
}
