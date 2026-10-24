import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Card, Flex, Typography } from "antd";
import { CloseOutlined, DownloadOutlined } from "@ant-design/icons";
import { canPromptInstall, isIos, isStandalone, promptInstall, subscribeInstall } from "../../lib/pwa";
import { fs } from "../../theme/tokens";

const { Text } = Typography;
const DISMISS_KEY = "wellsure.installPromptDismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false; // storage blocked — just show it again next time
  }
}

// "Install the Wellsure app" (Phase 5 commit G). On Android/Chrome it opens
// the browser's own install dialog; iOS Safari has no install event, so
// there it explains Share → Add to Home Screen. Hidden once installed or
// dismissed (remembered per device).
export function InstallAppBanner() {
  const installable = useSyncExternalStore(subscribeInstall, canPromptInstall);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [standalone, setStandalone] = useState(isStandalone);
  useEffect(() => subscribeInstall(() => setStandalone(isStandalone())), []);
  const ios = isIos();

  if (dismissed || standalone || (!installable && !ios)) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage blocked — dismissed for this visit only */
    }
  };
  return (
    <Card size="small" style={{ marginBottom: 12 }} data-testid="install-banner">
      <Flex align="center" gap={12}>
        <img src="/icons/icon-192.png" alt="" width={36} height={36} style={{ borderRadius: 8 }} />
        <div style={{ flex: 1 }}>
          <Text strong>Install the Wellsure app</Text>
          <div>
            <Text type="secondary" style={{ fontSize: fs.sm }}>
              {installable ? "Open it from your home screen, full-screen, like any app." : "Tap Share, then “Add to Home Screen”."}
            </Text>
          </div>
        </div>
        {installable && (
          <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={() => void promptInstall()}>
            Install
          </Button>
        )}
        <Button type="text" size="small" icon={<CloseOutlined />} aria-label="Dismiss" onClick={dismiss} />
      </Flex>
    </Card>
  );
}
