import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Input, Modal, type InputRef } from "antd";
import { EnterOutlined, FileTextOutlined, SearchOutlined } from "@ant-design/icons";
import { fs, space, v } from "../../theme/tokens";
import { preloadElement } from "../../routes/lazyPage";
import { useIsPhone } from "../../ui/hooks";
import { flattenLeaves, type NavEntry } from "./nav";

export interface PaletteAction {
  key: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  nav: NavEntry[];
  actions?: PaletteAction[];
}

function score(text: string, q: string): number {
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 3;
  if (t.includes(q)) return 2;
  // all query letters in order
  let i = 0;
  for (const c of t) if (c === q[i]) i += 1;
  return i === q.length ? 1 : 0;
}

// "Search anything…" (board top bar, with a Ctrl/⌘ K hint): jumps to any page the person can open, or runs a shell action (theme, sign out). Client-side only —
// it searches the menu, never data. Arrow keys move, Enter opens, Esc closes; focus returns to where it was.
export function CommandPalette({ open, onClose, nav, actions = [] }: Props) {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<InputRef>(null);

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    const pages = flattenLeaves(nav)
      .filter((l) => !l.soon)
      .map((l) => ({ key: l.key, label: l.label, hint: l.group, icon: l.icon ? <l.icon /> : <FileTextOutlined />, s: Math.max(score(l.label, query), score(`${l.group ?? ""} ${l.label}`, query) - 0.5), run: () => navigate(l.path), element: l.element }));
    const acts = actions.map((a) => ({ ...a, icon: a.icon ?? <EnterOutlined />, s: score(a.label, query), element: undefined }));
    return [...pages, ...acts].filter((i) => i.s > 0).sort((a, b) => b.s - a.s).slice(0, 12);
  }, [q, nav, actions, navigate]);

  // Each time it opens: an empty query and the first result selected (adjusted during render), then focus the box.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setQ("");
      setSel(0);
    }
  }
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    preloadElement(items[sel]?.element);
  }, [items, sel]);

  const run = (i: number) => {
    const it = items[i];
    if (!it) return;
    onClose();
    it.run();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={phone ? "100%" : 600}
      style={{ top: phone ? 0 : 96, maxWidth: phone ? "100vw" : undefined, margin: phone ? 0 : undefined, paddingBottom: 0 }}
      styles={{ container: { padding: space[3] } }}
      destroyOnHidden
      aria-label="Search pages"
    >
      <Input
        ref={input}
        size="large"
        variant="filled"
        prefix={<SearchOutlined aria-hidden style={{ color: v.textSecondary }} />}
        placeholder="Search pages and actions…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        role="combobox"
        aria-expanded
        aria-controls="ws-palette-list"
        aria-activedescendant={items[sel] ? `ws-palette-${items[sel].key}` : undefined}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(sel);
          }
        }}
      />
      <ul id="ws-palette-list" role="listbox" aria-label="Results" style={{ listStyle: "none", margin: `${space[3]}px 0 0`, padding: 0, maxHeight: phone ? "calc(100vh - 120px)" : 420, overflowY: "auto" }}>
        {items.length === 0 && <li style={{ padding: space[6], textAlign: "center", color: v.textSecondary }}>No page called “{q}”.</li>}
        {items.map((it, i) => (
          <li
            key={it.key}
            id={`ws-palette-${it.key}`}
            role="option"
            aria-selected={i === sel}
            className="ws-palette-item"
            onMouseEnter={() => setSel(i)}
            onClick={() => run(i)}
          >
            <span className="ws-palette-item__icon" aria-hidden>
              {it.icon}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 600, fontSize: fs.md }}>{it.label}</span>
              {it.hint && <span style={{ display: "block", fontSize: fs.sm, color: v.textSecondary }}>{it.hint}</span>}
            </span>
            {i === sel && <EnterOutlined aria-hidden style={{ color: v.textSecondary }} />}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
