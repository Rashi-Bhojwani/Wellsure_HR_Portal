import { Button, Tooltip } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { toast } from "../../../ui";
import { fs, fw, radius, space, v } from "../../../theme/tokens";

/** Backup (recovery) codes as a monospaced two-column grid with a copy-all button. Used by 2FA setup and Account & security. */
export function BackupCodeGrid({ codes }: { codes: string[] }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success("Backup codes copied");
    } catch {
      toast.error("Couldn't copy. Select the codes and copy them by hand.");
    }
  };
  return (
    <div style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, background: v.bgSubtle, padding: space[4] }}>
      <ol
        aria-label="Backup codes"
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: `${space[2]}px ${space[4]}px` }}
      >
        {codes.map((code) => (
          <li key={code} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: fs.md, fontWeight: fw.semibold, color: v.textPrimary, textAlign: "center", padding: `${space[1]}px 0`, letterSpacing: "0.06em" }}>
            {code}
          </li>
        ))}
      </ol>
      <div style={{ display: "flex", justifyContent: "center", marginTop: space[3] }}>
        <Tooltip title="Copy all codes">
          <Button icon={<CopyOutlined />} onClick={() => void copy()}>
            Copy codes
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
