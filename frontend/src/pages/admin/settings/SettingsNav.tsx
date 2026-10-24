import type { ReactNode } from "react";
import { Switch, Tabs } from "antd";
import { useIsPhone } from "../../../ui";
import { fs, fw, radius, space, v } from "../../../theme/tokens";

// Local building blocks for the settings-style screens (System settings, Organisation setup): the board's left sub-nav card (settings-01: icon +
// label, active = subtle pill with a green icon) that turns into scrollable tabs on phones (m-settings-01), and the bordered toggle row
// (settings-19: title + grey description + Switch).

export interface SectionNavItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Optional small group heading shown above this item (desktop only). */
  group?: string;
}

export function SectionNav({ items, active, onChange, label }: { items: SectionNavItem[]; active: string; onChange: (key: string) => void; label: string }) {
  const phone = useIsPhone();
  if (phone) {
    return <Tabs activeKey={active} onChange={onChange} items={items.map((it) => ({ key: it.key, label: it.label }))} aria-label={label} style={{ marginBottom: -space[2] }} />;
  }
  return (
    <nav aria-label={label} style={{ background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[4], position: "sticky", top: space[6] }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[1] }}>
        {items.map((it, i) => {
          const isActive = it.key === active;
          const showGroup = it.group && it.group !== items[i - 1]?.group;
          return (
            <li key={it.key}>
              {showGroup && (
                <div style={{ fontSize: fs.xs, fontWeight: fw.semibold, color: v.textSecondary, textTransform: "uppercase", letterSpacing: "0.04em", padding: `${i === 0 ? 0 : space[3]}px ${space[3]}px ${space[2]}px` }}>
                  {it.group}
                </div>
              )}
              <button
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => onChange(it.key)}
                className="ws-section-nav-item"
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: space[3],
                  minHeight: 44,
                  padding: `${space[2]}px ${space[3]}px`,
                  border: 0,
                  borderRadius: radius.md,
                  background: isActive ? v.bgSubtle : "transparent",
                  color: v.textPrimary,
                  fontSize: fs.md,
                  fontWeight: isActive ? fw.semibold : fw.medium,
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {it.icon && (
                  <span aria-hidden style={{ display: "inline-flex", fontSize: fs.lg, color: isActive ? v.accent : v.textSecondary }}>
                    {it.icon}
                  </span>
                )}
                <span style={{ minWidth: 0 }}>{it.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Sub-nav on the left (sticky), the active section's panel on the right; stacked on phones. */
export function SettingsLayout({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  const phone = useIsPhone();
  if (phone) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: space[4], minWidth: 0 }}>
        {nav}
        {children}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 248px) minmax(0, 1fr)", gap: space[6], alignItems: "start" }}>
      {nav}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: space[6] }}>{children}</div>
    </div>
  );
}

/** Bordered row: title + grey description on the left, a control (usually a Switch) on the right (settings-19). */
export function ToggleRow({ title, description, control, htmlFor }: { title: ReactNode; description?: ReactNode; control: ReactNode; htmlFor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space[4], padding: `${space[4]}px ${space[5]}px`, border: `1px solid ${v.borderDefault}`, borderRadius: radius.md }}>
      <div style={{ minWidth: 0 }}>
        <label htmlFor={htmlFor} style={{ display: "block", fontSize: fs.md, fontWeight: fw.semibold, color: v.textPrimary }}>
          {title}
        </label>
        {description && <div style={{ fontSize: fs.sm, color: v.textSecondary, marginTop: 2 }}>{description}</div>}
      </div>
      <div style={{ flex: "none" }}>{control}</div>
    </div>
  );
}

/** A Form-compatible multi-select shown as toggle rows: value is the array of switched-on keys (same shape as Checkbox.Group). */
export function SwitchList<K extends string>({ options, value = [], onChange, id }: { options: { value: K; label: string; description?: string }[]; value?: K[]; onChange?: (v: K[]) => void; id?: string }) {
  return (
    <div id={id} style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
      {options.map((o) => {
        const on = value.includes(o.value);
        const switchId = `${id ?? "switch-list"}-${o.value}`;
        return (
          <ToggleRow
            key={o.value}
            htmlFor={switchId}
            title={o.label}
            description={o.description}
            control={<Switch id={switchId} checked={on} onChange={(checked) => onChange?.(checked ? [...value, o.value] : value.filter((k) => k !== o.value))} />}
          />
        );
      })}
    </div>
  );
}

/** Grey explanatory paragraph under a panel title. */
export function SectionIntro({ children }: { children: ReactNode }) {
  return <p style={{ margin: `0 0 ${space[5]}px`, color: v.textSecondary, fontSize: fs.md, lineHeight: 1.6, maxWidth: 820 }}>{children}</p>;
}
