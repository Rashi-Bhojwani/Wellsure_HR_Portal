import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Typography } from "antd";
import { ArrowLeftOutlined, RightOutlined } from "@ant-design/icons";
import { fs, fw, space, v } from "../theme/tokens";
import { useIsPhone } from "./hooks";

export interface Crumb {
  label: string;
  to?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** "List Report › Employee Turnover Rate" (board reports-05). The last crumb is the current page. */
  breadcrumb?: Crumb[];
  /** Back chevron before the title (detail pages). `true` goes back in history; a string goes to that path. */
  back?: boolean | string;
  /** Buttons on the right (primary last). Wrap below the title on phones. */
  actions?: ReactNode;
  /** Chips or meta next to the title. */
  tags?: ReactNode;
  style?: React.CSSProperties;
}

// Page title row (DESIGN_SYSTEM.md §6.23): title 24/700, optional subtitle or breadcrumb, actions on the right. The h1 of every page.
export function PageHeader({ title, subtitle, breadcrumb, back, actions, tags, style }: PageHeaderProps) {
  const navigate = useNavigate();
  const phone = useIsPhone();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: phone ? "stretch" : "center", justifyContent: "space-between", gap: space[4], marginBottom: space[6], ...style }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: space[2], minWidth: 0, flex: "1 1 320px" }}>
        {back && (
          <Button
            type="text"
            aria-label="Back"
            icon={<ArrowLeftOutlined />}
            onClick={() => (typeof back === "string" ? navigate(back) : navigate(-1))}
            style={{ marginTop: 2, marginLeft: -8, flex: "none" }}
          />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: space[3], flexWrap: "wrap" }}>
            <Typography.Title level={1} style={{ margin: 0, fontSize: phone ? fs.h2 + 2 : fs.h1, lineHeight: 1.3, fontWeight: fw.bold }}>
              {title}
            </Typography.Title>
            {tags}
          </div>
          {breadcrumb && breadcrumb.length > 0 ? (
            <nav aria-label="Breadcrumb" style={{ marginTop: space[1] }}>
              <ol style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space[2], listStyle: "none", margin: 0, padding: 0, fontSize: fs.md }}>
                {breadcrumb.map((c, i) => {
                  const last = i === breadcrumb.length - 1;
                  return (
                    <li key={`${c.label}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
                      {c.to && !last ? (
                        <Link to={c.to} style={{ color: v.textSecondary }}>
                          {c.label}
                        </Link>
                      ) : (
                        <span aria-current={last ? "page" : undefined} style={{ color: last ? v.textPrimary : v.textSecondary }}>
                          {c.label}
                        </span>
                      )}
                      {!last && <RightOutlined aria-hidden style={{ fontSize: fs.xs, color: v.textSecondary }} />}
                    </li>
                  );
                })}
              </ol>
            </nav>
          ) : subtitle ? (
            <div style={{ marginTop: space[1], color: v.textSecondary, fontSize: fs.md }}>{subtitle}</div>
          ) : null}
        </div>
      </div>
      {actions && <div style={{ display: "flex", flexWrap: "wrap", gap: space[3], alignItems: "center", justifyContent: phone ? "stretch" : "flex-end", width: phone ? "100%" : undefined }}>{actions}</div>}
    </div>
  );
}
