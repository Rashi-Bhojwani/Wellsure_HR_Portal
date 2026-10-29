import type { ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { FileExcelOutlined, FileImageOutlined, FilePdfOutlined, FileTextOutlined, FileWordOutlined, FolderFilled } from "@ant-design/icons";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { useIsPhone } from "../../../ui";

// Small pieces shared by the employee Document Center and the admin Company Documents page (board documents-01..05).

function iconFor(mimeType: string, fileName: string): { icon: ReactNode; color: string } {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType === "application/pdf" || ext === "pdf") return { icon: <FilePdfOutlined />, color: v.danger };
  if (mimeType.includes("word") || ext === "doc" || ext === "docx") return { icon: <FileWordOutlined />, color: v.edit };
  if (mimeType.includes("sheet") || mimeType.includes("excel") || ext === "xls" || ext === "xlsx" || ext === "csv") return { icon: <FileExcelOutlined />, color: v.view };
  if (mimeType.startsWith("image/")) return { icon: <FileImageOutlined />, color: v.chipPurpleText };
  return { icon: <FileTextOutlined />, color: v.textSecondary };
}

/** File-type icon in a soft square, then the name and a caption (documents-03). */
export function FileName({ title, caption, mimeType, fileName }: { title: ReactNode; caption?: ReactNode; mimeType: string; fileName: string }) {
  const { icon, color } = iconFor(mimeType, fileName);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: space[3], minWidth: 0 }}>
      <span aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, background: v.bgSubtle, color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.lg, flex: "none" }}>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: fw.semibold, color: v.textPrimary, wordBreak: "break-word" }}>{title}</div>
        {caption && <div style={{ color: v.textSecondary, fontSize: fs.sm }}>{caption}</div>}
      </div>
    </div>
  );
}

/** Folder icon + name (documents-01's "Name" column). */
export function FolderName({ name, caption }: { name: ReactNode; caption?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: space[3], minWidth: 0 }}>
      <span aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, background: v.chipWarningBg, color: v.chipWarningText, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.lg, flex: "none" }}>
        <FolderFilled />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{name}</div>
        {caption && <div style={{ color: v.textSecondary, fontSize: fs.sm }}>{caption}</div>}
      </div>
    </div>
  );
}

const TONE_BG = { view: v.view, edit: v.edit, danger: v.danger } as const;

/** The board's solid 32px square row action (view green, download/edit blue, delete red) with a white icon. 44px on phones. */
export function SquareAction({ tone, icon, label, onClick, loading }: { tone: keyof typeof TONE_BG; icon: ReactNode; label: string; onClick: () => void; loading?: boolean }) {
  const phone = useIsPhone();
  const size = phone ? 44 : 32;
  return (
    <Tooltip title={label}>
      <Button
        aria-label={label}
        icon={icon}
        loading={loading}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        style={{ width: size, height: size, minWidth: size, padding: 0, borderRadius: radius.xs, background: TONE_BG[tone], borderColor: TONE_BG[tone], color: v.navActiveText }}
      />
    </Tooltip>
  );
}
