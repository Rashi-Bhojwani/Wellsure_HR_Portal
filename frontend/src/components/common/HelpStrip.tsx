import { useState } from "react";
import { Button } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { ApprovalBanner } from "../../ui/ApprovalBanner";
import { space } from "../../theme/tokens";

interface HelpStripProps {
  children: React.ReactNode;
  storageKey: string;
}

// Dismissible help banner at the top of many admin pages (docs/UI_REFERENCE.md §2.0), in the design system's info banner. Dismissal is remembered per browser only —
// a per-viewer convenience, not server state.
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
    <ApprovalBanner
      tone="info"
      title={children}
      style={{ marginBottom: space[4] }}
      actions={
        <Button type="text" size="small" onClick={hide} icon={<CloseOutlined />}>
          Hide help
        </Button>
      }
    />
  );
}
