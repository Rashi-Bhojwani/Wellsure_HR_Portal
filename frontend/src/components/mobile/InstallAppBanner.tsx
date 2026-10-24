import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Tooltip } from "antd";
import { CloseOutlined, DownloadOutlined } from "@ant-design/icons";
import { canPromptInstall, isIos, isStandalone, promptInstall, subscribeInstall } from "../../lib/pwa";
import { fs, fw, radius, space, v } from "../../theme/tokens";
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
    <div
      data-testid="install-banner"
      role="region"
      aria-label="Install the app"
      style={{ display: "flex", alignItems: "center", gap: space[3], background: v.infoSubtle, borderRadius: radius.md, padding: `${space[3]}px ${space[3]}px ${space[3]}px ${space[4]}px`, marginBottom: space[3] }}
    >
      <img src="/icons/icon-192.png" alt="" width={40} height={40} style={{ borderRadius: radius.sm, flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: v.infoText, fontWeight: fw.semibold, fontSize: fs.md }}>Install the Wellsure app</div>
        <div style={{ color: v.textBody, fontSize: fs.sm, marginTop: 2 }}>
          {installable ? "Open it from your home screen, full-screen, like any app." : "Tap Share, then “Add to Home Screen”."}
        </div>
      </div>
      {installable && (
        <Button type="primary" icon={<DownloadOutlined />} onClick={() => void promptInstall()}>
          Install
        </Button>
      )}
      <Tooltip title="Dismiss">
        <Button type="text" icon={<CloseOutlined />} aria-label="Dismiss" onClick={dismiss} style={{ color: v.textSecondary, flex: "none" }} />
      </Tooltip>
    </div>
  );
}
