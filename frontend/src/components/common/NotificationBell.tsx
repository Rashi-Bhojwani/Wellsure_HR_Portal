import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Drawer, Grid, Popover, Typography } from "antd";
import { BellOutlined } from "@ant-design/icons";
import * as notificationsApi from "../../api/notifications";
import { EmptyState } from "../../ui/EmptyState";
import { Skel } from "../../ui/Skeletons";
import { fs, fw, radius, space, v } from "../../theme/tokens";

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

const { Text } = Typography;
const { useBreakpoint } = Grid;

// Shared bell + notification centre, used by both EmployeeLayout and
// AdminLayout headers (spec §8) — one component so the two portals never
// drift on read/mark-read/mark-all-read behaviour. `homePath` is where a
// notification with no `link` field falls back to.
export function NotificationBell({ homePath }: { homePath: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  // Escape closes it wherever the focus happens to be.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: notificationsApi.getUnreadCount,
  });

  const { data } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => notificationsApi.listNotifications(1, 20),
    enabled: open,
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  const markReadMutation = useMutation({
    mutationFn: notificationsApi.markAsRead,
    onSuccess: invalidate,
  });

  const markAllReadMutation = useMutation({
    mutationFn: notificationsApi.markAllAsRead,
    onSuccess: invalidate,
  });

  function handleClick(row: notificationsApi.NotificationRow): void {
    if (!row.readAt) markReadMutation.mutate(row.id);
    setOpen(false);
    navigate(row.link ?? homePath);
  }

  const content = (
    <div style={{ width: isMobile ? "100%" : 380 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `${space[1]}px ${space[1]}px ${space[3]}px` }}>
        <Text strong style={{ fontSize: fs.lg }}>
          Notifications
        </Text>
        <Button type="link" size="small" disabled={unreadCount === 0} onClick={() => markAllReadMutation.mutate()}>
          Mark all read
        </Button>
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto", margin: `0 -${space[1]}px` }}>
        {!data ? (
          <div aria-busy="true" aria-label="Loading notifications" style={{ display: "flex", flexDirection: "column", gap: space[4], padding: `${space[3]}px ${space[2]}px` }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: "flex", gap: space[3], alignItems: "center" }}>
                <Skel w={40} h={40} r={radius.pill} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: space[2] }}>
                  <Skel w="60%" h={14} />
                  <Skel w="90%" h={12} />
                </div>
              </div>
            ))}
          </div>
        ) : data.rows.length > 0 ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {data.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => handleClick(row)}
                  style={{
                    display: "flex",
                    gap: space[3],
                    width: "100%",
                    minHeight: 64,
                    padding: `${space[3]}px ${space[2]}px`,
                    border: 0,
                    borderBottom: `1px solid ${v.borderDefault}`,
                    background: "transparent",
                    textAlign: "left",
                    font: "inherit",
                    cursor: "pointer",
                    color: "inherit",
                  }}
                >
                  <span aria-hidden style={{ width: 40, height: 40, flex: "none", borderRadius: radius.pill, background: row.readAt ? v.bgSubtle : v.accentSubtle, color: row.readAt ? v.textSecondary : v.accentText, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.lg }}>
                    <BellOutlined />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", gap: space[2], alignItems: "baseline" }}>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: row.readAt ? fw.medium : fw.bold, color: v.textPrimary, fontSize: fs.md, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</span>
                      <span style={{ flex: "none", fontSize: fs.xs, color: v.textSecondary }}>{relativeTime(row.createdAt)}</span>
                    </span>
                    <span style={{ display: "flex", gap: space[2], alignItems: "center", marginTop: 2 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: fs.sm, color: v.textSecondary, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{row.body}</span>
                      {!row.readAt && <span role="img" aria-label="Unread" style={{ width: 8, height: 8, borderRadius: radius.pill, background: v.danger, flex: "none" }} />}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="You're all caught up" description="New notifications will appear here." compact illustration="inbox" />
        )}
      </div>
    </div>
  );

  const bell = (
    <Badge count={unreadCount} size="small" offset={[-6, 6]}>
      <button type="button" className="ws-icon-btn" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"} onClick={isMobile ? () => setOpen(true) : undefined}>
        <BellOutlined />
      </button>
    </Badge>
  );

  // On a phone a popover anchored to a bell near the right edge cannot be 340px wide and stay on the screen, so it is a sheet from the top instead: the full width,
  // an opaque surface, closed by the X, a tap outside or Escape.
  if (isMobile) {
    return (
      <>
        {bell}
        <Drawer title="Notifications" placement="top" size="auto" open={open} onClose={() => setOpen(false)} styles={{ body: { padding: space[3] } }}>
          {content}
        </Drawer>
      </>
    );
  }

  return (
    <Popover trigger="click" placement="bottomRight" open={open} onOpenChange={setOpen} content={content}>
      {bell}
    </Popover>
  );
}
