import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Drawer, Grid, List, Popover, Space, Typography } from "antd";
import { BellOutlined } from "@ant-design/icons";
import * as notificationsApi from "../../api/notifications";
import { EmptyState } from "./EmptyState";

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
    <div style={{ width: isMobile ? "100%" : 340 }}>
      <Space style={{ width: "100%", justifyContent: "space-between", padding: "4px 4px 8px" }}>
        <Text strong>Notifications</Text>
        <Button
          type="link"
          size="small"
          disabled={unreadCount === 0}
          onClick={() => markAllReadMutation.mutate()}
        >
          Mark all read
        </Button>
      </Space>
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {data && data.rows.length > 0 ? (
          <List
            size="small"
            dataSource={data.rows}
            renderItem={(row) => (
              <List.Item
                onClick={() => handleClick(row)}
                style={{ cursor: "pointer", background: row.readAt ? undefined : "#f0f5ff", padding: "8px 8px" }}
              >
                <List.Item.Meta
                  title={<Text strong={!row.readAt}>{row.title}</Text>}
                  description={
                    <>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {row.body}
                      </Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {new Date(row.createdAt).toLocaleString()}
                      </Text>
                    </>
                  }
                />
              </List.Item>
            )}
          />
        ) : (
          <EmptyState message="No notifications yet" compact />
        )}
      </div>
    </div>
  );

  const bell = (
    <Badge count={unreadCount} size="small" offset={[-2, 2]}>
      <BellOutlined style={{ fontSize: 18, cursor: "pointer" }} onClick={isMobile ? () => setOpen(true) : undefined} />
    </Badge>
  );

  // On a phone a popover anchored to a bell near the right edge cannot be 340px wide and stay on the screen, so it is a sheet from the top instead: the full width,
  // an opaque surface, closed by the X, a tap outside or Escape.
  if (isMobile) {
    return (
      <>
        {bell}
        <Drawer title="Notifications" placement="top" size="auto" open={open} onClose={() => setOpen(false)} styles={{ body: { padding: 12 } }}>
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
