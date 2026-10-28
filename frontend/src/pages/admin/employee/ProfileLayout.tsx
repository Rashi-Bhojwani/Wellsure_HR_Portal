import type { ReactNode } from "react";
import { Button, Dropdown, Tabs, type MenuProps, type TabsProps } from "antd";
import { DownOutlined, IdcardOutlined, MailOutlined, PhoneOutlined, RightOutlined } from "@ant-design/icons";
import type * as employeeApi from "../../../api/employee";
import { InitialsAvatar, KeyValueGrid, Panel, StatusChip, useIsCompact, useIsPhone, type KeyValueItem } from "../../../ui";
import { fs, fw, radius, space, v } from "../../../theme/tokens";

// The employee detail layout shared by the admin profile and View My Info (employees-05..11): a profile card on the left (on top on phones and
// tablets) and a tabbed panel on the right whose tabs hold titled sections (FormSection-style cards with label/value grids).

export function ProfileShell({ card, children }: { card: ReactNode; children: ReactNode }) {
  const compact = useIsCompact();
  const phone = useIsPhone();
  return (
    <div style={{ display: "grid", gridTemplateColumns: compact ? "minmax(0, 1fr)" : "300px minmax(0, 1fr)", gap: phone ? space[4] : space[6], alignItems: "start" }}>
      {card}
      {children}
    </div>
  );
}

function ContactRow({ icon, children, label }: { icon: ReactNode; children: ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: space[3], color: v.textBody, fontSize: fs.md, minWidth: 0 }}>
      <span aria-hidden style={{ color: v.textSecondary, display: "inline-flex", flex: "none" }}>
        {icon}
      </span>
      <span className="ws-sr-label" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {label}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
    </div>
  );
}

function InfoRow({ label, value, onOpen, leading }: { label: string; value: ReactNode; onOpen?: () => void; leading?: ReactNode }) {
  const body = (
    <>
      <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
        <span style={{ display: "block", fontSize: fs.sm, color: v.textSecondary }}>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: space[2], marginTop: 2, fontSize: fs.md, fontWeight: fw.semibold, color: v.textPrimary, minWidth: 0 }}>
          {leading}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
        </span>
      </span>
      {onOpen && <RightOutlined aria-hidden style={{ color: v.textSecondary, fontSize: fs.sm }} />}
    </>
  );
  const style = { display: "flex", alignItems: "center", gap: space[2], width: "100%", padding: `${space[2]}px 0`, minHeight: 44 } as const;
  return onOpen ? (
    <button type="button" onClick={onOpen} aria-label={`${label}: ${typeof value === "string" ? value : ""}`} style={{ ...style, background: "none", border: 0, cursor: "pointer", font: "inherit", borderRadius: radius.sm }}>
      {body}
    </button>
  ) : (
    <div style={style}>{body}</div>
  );
}

export interface ProfileCardProps {
  profile: employeeApi.EmployeeProfile;
  /** The avatar, usually a stacked PhotoUploader. */
  avatar: ReactNode;
  /** Opens the reporting manager (admin profile only). */
  onOpenManager?: (id: string) => void;
  /** The "Action ▾" menu; hidden when empty. */
  actions?: MenuProps["items"];
}

/** The board's profile card (employees-05): avatar, name, designation, status, contact rows, job rows, Action menu. No sensitive value ever appears here. */
export function ProfileCard({ profile, avatar, onOpenManager, actions }: ProfileCardProps) {
  const mgr = profile.job?.reportingManager ?? null;
  return (
    <Panel as="div" bodyStyle={{ display: "flex", flexDirection: "column", gap: space[4] }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: space[2], textAlign: "center" }}>
        {avatar}
        <h2 style={{ margin: `${space[2]}px 0 0`, fontSize: fs.h2, fontWeight: fw.bold, color: v.textPrimary, lineHeight: 1.3, wordBreak: "break-word" }}>{profile.fullName}</h2>
        <div style={{ color: v.textSecondary, fontSize: fs.md }}>{profile.job?.designation.name ?? "—"}</div>
        <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: "center" }}>
          <StatusChip status={profile.status} />
          {profile.attendanceCapture === "MANUAL" && (
            <StatusChip tone="purple" title="No biometric device: their attendance is marked manually by whoever marks their branch.">
              Manual attendance
            </StatusChip>
          )}
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${v.borderDefault}`, paddingTop: space[4], display: "flex", flexDirection: "column", gap: space[3] }}>
        <ContactRow icon={<IdcardOutlined />} label="Employee code">
          {profile.employeeCode}
        </ContactRow>
        {profile.officialEmail && (
          <ContactRow icon={<MailOutlined />} label="Official email">
            <a href={`mailto:${profile.officialEmail}`}>{profile.officialEmail}</a>
          </ContactRow>
        )}
        {profile.personal?.mobile && (
          <ContactRow icon={<PhoneOutlined />} label="Mobile">
            <a href={`tel:${profile.personal.mobile}`}>{profile.personal.mobile}</a>
          </ContactRow>
        )}
      </div>
      <div style={{ borderTop: `1px solid ${v.borderDefault}`, paddingTop: space[2] }}>
        <InfoRow label="Department" value={profile.job?.department.name ?? "—"} />
        <InfoRow label="Office" value={profile.job?.location.name ?? "—"} />
        <InfoRow
          label="Reporting manager"
          value={mgr?.fullName ?? "—"}
          leading={mgr ? <InitialsAvatar name={mgr.fullName} size={28} /> : undefined}
          onOpen={mgr && onOpenManager ? () => onOpenManager(mgr.id) : undefined}
        />
      </div>
      {actions && actions.length > 0 && (
        <Dropdown menu={{ items: actions }} trigger={["click"]} placement="bottom">
          <Button type="primary" size="large" block>
            Action <DownOutlined />
          </Button>
        </Dropdown>
      )}
    </Panel>
  );
}

/** The right-hand tabbed card: green-underlined tabs, sections stacked inside. Tabs scroll sideways on phones. */
export function ProfileTabs({ items, activeKey, onChange }: { items: NonNullable<TabsProps["items"]>; activeKey?: string; onChange?: (key: string) => void }) {
  const phone = useIsPhone();
  return (
    <Panel bodyStyle={{ paddingTop: phone ? space[2] : space[3] }}>
      {/* A tighter gutter so all seven admin tabs (up to Access) fit beside the profile card at 1280 instead of hiding the last ones behind "…". */}
      <Tabs items={items} activeKey={activeKey} onChange={onChange} destroyOnHidden={false} tabBarGutter={phone ? undefined : space[6]} />
    </Panel>
  );
}

/** One titled section inside a tab (board: "Personal Info" with a pencil). */
export function ProfileSection({ title, onEdit, editLabel, extra, children }: { title: ReactNode; onEdit?: () => void; editLabel?: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <Panel title={title} onEdit={onEdit} editLabel={editLabel} extra={extra}>
      {children}
    </Panel>
  );
}

export function SectionStack({ children }: { children: ReactNode }) {
  const phone = useIsPhone();
  return <div style={{ display: "flex", flexDirection: "column", gap: phone ? space[4] : space[5], marginTop: space[2] }}>{children}</div>;
}

export function Grid({ items }: { items: KeyValueItem[] }) {
  return <KeyValueGrid items={items} />;
}
