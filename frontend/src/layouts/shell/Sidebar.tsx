import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button, Tooltip } from "antd";
import { DoubleLeftOutlined, DoubleRightOutlined, DownOutlined } from "@ant-design/icons";
import { preloadElement } from "../../routes/lazyPage";
import { BrandMark } from "./BrandMark";
import { activeLeafFor, type NavEntry, type NavLeaf } from "./nav";

export interface PinnedLink {
  key: string;
  label: string;
  path: string;
  icon: ReactNode;
  badge?: number;
}

interface SidebarProps {
  nav: NavEntry[];
  /** The first leaf gets the board's green pill when active (Home / Dashboard). */
  homeKey: string;
  pinned: PinnedLink[];
  footer?: ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Called after a link is followed (closes the tablet drawer). */
  onNavigate?: () => void;
  /** In the tablet drawer: always expanded, no collapse button. */
  inDrawer?: boolean;
}

function LeafLink({ leaf, active, pill, collapsed, onNavigate }: { leaf: NavLeaf; active: boolean; pill?: boolean; collapsed?: boolean; onNavigate?: () => void }) {
  const Icon = leaf.icon;
  const link = (
    <Link
      to={leaf.path}
      className="ws-nav__item"
      data-variant={pill ? "pill" : undefined}
      data-soon={leaf.soon ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => preloadElement(leaf.element)}
      onFocus={() => preloadElement(leaf.element)}
      onClick={onNavigate}
    >
      {Icon && (
        <span className="ws-nav__icon" aria-hidden>
          <Icon />
        </span>
      )}
      <span className="ws-nav__label">{leaf.label}</span>
      {leaf.soon && <span className="ws-nav__soon">Soon</span>}
    </Link>
  );
  return collapsed ? (
    <Tooltip title={leaf.label} placement="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

// The board's sidebar (home-02, employees-01): text logo + collapse, the green active pill for Home, grouped items with chevrons, children on a guide line with a
// subtle active pill, Help / Settings / theme pinned at the bottom. Links are real <a> elements: keyboard, middle-click and screen readers all work.
export function Sidebar({ nav, homeKey, pinned, footer, collapsed = false, onToggleCollapsed, onNavigate, inDrawer = false }: SidebarProps) {
  const location = useLocation();
  const active = activeLeafFor(nav, location.pathname);
  const activeGroup = nav.find((e) => e.kind === "group" && e.children.some((c) => c.kind === "leaf" && c.key === active?.key));
  const [open, setOpen] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup.key] : []));

  // Opening a page inside a closed group opens that group (adjusted during render when the active group changes).
  const [seenGroup, setSeenGroup] = useState(activeGroup?.key);
  if (seenGroup !== activeGroup?.key) {
    setSeenGroup(activeGroup?.key);
    if (activeGroup && !open.has(activeGroup.key)) setOpen((s) => new Set(s).add(activeGroup.key));
  }

  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const isCollapsed = collapsed && !inDrawer;

  return (
    <aside className="ws-sidebar" data-collapsed={isCollapsed ? "true" : "false"} aria-label="Main navigation" style={inDrawer ? { position: "static", height: "100%", width: "100%", borderRight: "none" } : undefined}>
      <div className="ws-sidebar__brand">
        <Link to={nav[0]?.kind === "leaf" ? nav[0].path : "/"} aria-label="Wellsure HR Portal, home" onClick={onNavigate} style={{ display: "inline-flex", minWidth: 0 }}>
          <BrandMark compact={isCollapsed} />
        </Link>
        {!inDrawer && onToggleCollapsed && !isCollapsed && (
          <Tooltip title="Collapse the menu" placement="right">
            <Button type="text" size="small" aria-label="Collapse the menu" icon={<DoubleLeftOutlined />} onClick={onToggleCollapsed} />
          </Tooltip>
        )}
      </div>
      {isCollapsed && onToggleCollapsed && (
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: 8 }}>
          <Tooltip title="Expand the menu" placement="right">
            <Button type="text" size="small" aria-label="Expand the menu" icon={<DoubleRightOutlined />} onClick={onToggleCollapsed} />
          </Tooltip>
        </div>
      )}
      <nav className="ws-sidebar__scroll">
        <ul className="ws-nav">
          {nav.map((entry) => {
            if (entry.kind === "leaf") {
              return (
                <li key={entry.key}>
                  <LeafLink leaf={entry} active={active?.key === entry.key} pill={entry.key === homeKey} collapsed={isCollapsed} onNavigate={onNavigate} />
                </li>
              );
            }
            const Icon = entry.icon;
            const isOpen = open.has(entry.key);
            const isActiveGroup = activeGroup?.key === entry.key;
            const groupId = `ws-nav-${entry.key}`;
            const header = (
              <button
                type="button"
                className="ws-nav__item"
                aria-expanded={isCollapsed ? undefined : isOpen}
                aria-controls={isCollapsed ? undefined : groupId}
                data-active-group={isActiveGroup ? "true" : undefined}
                onClick={() => {
                  if (isCollapsed) {
                    onToggleCollapsed?.();
                    setOpen((s) => new Set(s).add(entry.key));
                  } else toggle(entry.key);
                }}
              >
                {Icon && (
                  <span className="ws-nav__icon" aria-hidden>
                    <Icon />
                  </span>
                )}
                <span className="ws-nav__label">{entry.label}</span>
                <DownOutlined className="ws-nav__chevron" aria-hidden />
              </button>
            );
            return (
              <li key={entry.key}>
                {isCollapsed ? (
                  <Tooltip title={entry.label} placement="right">
                    {header}
                  </Tooltip>
                ) : (
                  header
                )}
                {isOpen && !isCollapsed && (
                  <ul id={groupId} className="ws-nav__children">
                    {entry.children.map((c) =>
                      c.kind === "section" ? (
                        <li key={c.key} className="ws-nav__section" aria-hidden>
                          {c.label}
                        </li>
                      ) : (
                        <li key={c.key}>
                          <LeafLink leaf={c} active={active?.key === c.key} onNavigate={onNavigate} />
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="ws-sidebar__bottom">
        <ul className="ws-nav">
          {pinned.map((p) => {
            const isActive = location.pathname === p.path || location.pathname.startsWith(`${p.path}/`);
            const link = (
              <Link to={p.path} className="ws-nav__item" aria-current={isActive ? "page" : undefined} onClick={onNavigate}>
                <span className="ws-nav__icon" aria-hidden>
                  {p.icon}
                </span>
                <span className="ws-nav__label">{p.label}</span>
                {p.badge ? <span className="ws-nav__badge" aria-label={`${p.badge} open`}>{p.badge > 99 ? "99+" : p.badge}</span> : null}
              </Link>
            );
            return <li key={p.key}>{isCollapsed ? <Tooltip title={p.label} placement="right">{link}</Tooltip> : link}</li>;
          })}
        </ul>
        {footer && <div className="ws-collapsible" style={{ marginTop: 8 }}>{footer}</div>}
      </div>
    </aside>
  );
}
