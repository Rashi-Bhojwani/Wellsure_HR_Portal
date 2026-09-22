import { useState } from "react";
import { Button, Space, Typography } from "antd";
import { CloseOutlined, InfoCircleOutlined } from "@ant-design/icons";

const { Text } = Typography;

interface HelpStripProps {
  children: React.ReactNode;
  storageKey: string;
}

// Dismissible light-cyan help banner shown at the top of many admin pages
// (docs/UI_REFERENCE.md §2.0). Dismissal is remembered per browser only —
// it's a per-viewer UI convenience, not server state.
export function HelpStrip({ children, storageKey }: HelpStripProps) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(`wellsure-help-${storageKey}`) === "1";
    } catch {
      return false;
    }
  });

  if (hidden) return null;

  const hide = (): void => {
    setHidden(true);
    try {
      localStorage.setItem(`wellsure-help-${storageKey}`, "1");
    } catch {
      // ignore
    }
  };

  return (
    <div
      style={{
        background: "#e6f7fb",
        border: "1px solid #b7e6f2",
        borderRadius: 8,
        padding: "10px 16px",
        marginBottom: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <Space>
        <InfoCircleOutlined style={{ color: "#0e7f9c" }} />
        <Text>{children}</Text>
      </Space>
      <Button type="text" size="small" onClick={hide} icon={<CloseOutlined />}>
        Hide Help
      </Button>
    </div>
  );
}
