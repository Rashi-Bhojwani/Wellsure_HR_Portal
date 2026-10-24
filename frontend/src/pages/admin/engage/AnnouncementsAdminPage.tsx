import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Select, Switch, Tooltip } from "antd";
import dayjs from "dayjs";
import { CalendarOutlined, DeleteOutlined, EditOutlined, EnvironmentOutlined, LinkOutlined, PlusOutlined } from "@ant-design/icons";
import * as announcementsApi from "../../../api/announcements";
import * as orgApi from "../../../api/org";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { ConfirmModal, EmptyState, PageHeader, Panel, SideDrawer, Skel, Stack, StatusChip, toast, useIsPhone } from "../../../ui";

const { RangePicker } = DatePicker;

const FORM_ID = "announcement-form";

function AnnouncementDrawer({ open, editing, onClose }: { open: boolean; editing: announcementsApi.AnnouncementRow | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations(), staleTime: 30_000 });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list, staleTime: 30_000 });

  const saveMutation = useMutation({
    mutationFn: (values: {
      title: string;
      body: string;
      linkLabel?: string;
      linkUrl?: string;
      scopeLocationId?: string;
      scopeDepartmentId?: string;
      range: [dayjs.Dayjs, dayjs.Dayjs];
      isActive?: boolean;
    }) => {
      const input = {
        title: values.title,
        body: values.body,
        linkLabel: values.linkLabel || undefined,
        linkUrl: values.linkUrl || undefined,
        scopeLocationId: values.scopeLocationId ?? null,
        scopeDepartmentId: values.scopeDepartmentId ?? null,
        activeFrom: values.range[0].format("YYYY-MM-DD"),
        activeTo: values.range[1].format("YYYY-MM-DD"),
        ...(editing && { isActive: values.isActive }),
      };
      return editing ? announcementsApi.updateAnnouncement(editing.id, input) : announcementsApi.createAnnouncement(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["announcements", "all"] });
      toast.success(editing ? "Announcement updated." : "Announcement created.");
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save this announcement.")),
  });

  const twoCol = { display: "grid", gridTemplateColumns: phone ? "1fr" : "1fr 1fr", columnGap: space[4] } as const;

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      size="wide"
      title={editing ? "Edit Announcement" : "Add Announcement"}
      subtitle="Shown on the Employee Home banner during its active window."
      formId={FORM_ID}
      primaryLabel="Save"
      primaryLoading={saveMutation.isPending}
    >
      <Form
        id={FORM_ID}
        form={form}
        layout="vertical"
        requiredMark
        onFinish={(vals) => saveMutation.mutate(vals)}
        initialValues={
          editing
            ? { ...editing, linkLabel: editing.linkLabel ?? undefined, linkUrl: editing.linkUrl ?? undefined, scopeLocationId: editing.scopeLocationId ?? undefined, scopeDepartmentId: editing.scopeDepartmentId ?? undefined, range: [dayjs(editing.activeFrom), dayjs(editing.activeTo)] }
            : { isActive: true }
        }
      >
        <Form.Item name="title" label="Title" rules={[{ required: true, max: 200 }]}>
          <Input placeholder="Input news title" />
        </Form.Item>
        <Form.Item name="body" label="Body" rules={[{ required: true, max: 2000 }]}>
          <Input.TextArea autoSize={{ minRows: 6, maxRows: 14 }} showCount maxLength={2000} placeholder="What should employees know?" />
        </Form.Item>
        <div style={twoCol}>
          <Form.Item name="linkLabel" label="Link Label">
            <Input />
          </Form.Item>
          <Form.Item name="linkUrl" label="Link URL">
            <Input />
          </Form.Item>
          <Form.Item name="scopeLocationId" label="Location (blank = all)">
            <Select allowClear options={locations.map((l) => ({ value: l.id, label: l.name }))} />
          </Form.Item>
          <Form.Item name="scopeDepartmentId" label="Department (blank = all)">
            <Select allowClear options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          </Form.Item>
        </div>
        <Form.Item name="range" label="Active window" rules={[{ required: true }]}>
          <RangePicker style={{ width: "100%" }} />
        </Form.Item>
        {editing && (
          <Form.Item name="isActive" label="Active" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch />
          </Form.Item>
        )}
      </Form>
    </SideDrawer>
  );
}

function fmt(d: string) {
  return dayjs(d).format("DD MMM YYYY");
}

function AnnouncementCard({ row, scopeLabel, onEdit, onDelete }: { row: announcementsApi.AnnouncementRow; scopeLabel: string; onEdit: () => void; onDelete: () => void }) {
  const phone = useIsPhone();
  const meta = { display: "inline-flex", alignItems: "center", gap: space[1], color: v.textSecondary, fontSize: fs.table } as const;
  return (
    <article style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: phone ? space[4] : `${space[5]}px ${space[6]}px`, display: "flex", gap: space[4], alignItems: "flex-start", background: v.bgSurface }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary, wordBreak: "break-word" }}>{row.title}</div>
        <div style={{ color: v.textBody, fontSize: fs.md, marginTop: space[1], display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{row.body}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: `${space[2]}px ${space[4]}px`, marginTop: space[3] }}>
          <span style={meta}>
            <CalendarOutlined aria-hidden /> {fmt(row.activeFrom)} – {fmt(row.activeTo)}
          </span>
          <span style={meta}>
            <EnvironmentOutlined aria-hidden /> {scopeLabel}
          </span>
          {row.linkUrl && (
            <span style={meta}>
              <LinkOutlined aria-hidden /> {row.linkLabel || row.linkUrl}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: space[3], flex: "none" }}>
        <StatusChip tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Paused"}</StatusChip>
        <div style={{ display: "flex", gap: space[1] }}>
          <Tooltip title="Edit">
            <Button type="text" aria-label={`Edit ${row.title}`} icon={<EditOutlined />} onClick={onEdit} />
          </Tooltip>
          <Tooltip title="Delete">
            <Button type="text" danger aria-label={`Delete ${row.title}`} icon={<DeleteOutlined />} onClick={onDelete} />
          </Tooltip>
        </div>
      </div>
    </article>
  );
}

export function AnnouncementsAdminPage() {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<announcementsApi.AnnouncementRow | null>(null);
  const [deleting, setDeleting] = useState<announcementsApi.AnnouncementRow | null>(null);
  const [status, setStatus] = useState<"all" | "active" | "paused">("all");
  const { data: announcements = [], isLoading, error, refetch } = useQuery({ queryKey: ["announcements", "all"], queryFn: announcementsApi.listAnnouncements });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations(), staleTime: 30_000 });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list, staleTime: 30_000 });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => announcementsApi.deleteAnnouncement(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["announcements", "all"] });
      toast.success("Announcement deleted.");
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete this announcement.")),
  });

  const rows = useMemo(() => announcements.filter((a) => (status === "all" ? true : status === "active" ? a.isActive : !a.isActive)), [announcements, status]);

  const scopeLabel = (a: announcementsApi.AnnouncementRow) => {
    if (!a.scopeLocationId && !a.scopeDepartmentId) return "Org-wide";
    const parts = [locations.find((l) => l.id === a.scopeLocationId)?.name, departments.find((d) => d.id === a.scopeDepartmentId)?.name].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Scoped";
  };

  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const addButton = (
    <Button type="primary" icon={<PlusOutlined />} onClick={openNew} block={phone}>
      Add Announcement
    </Button>
  );

  return (
    <>
      <PageHeader title="Announcements" subtitle="Banners on the Employee Home page" actions={addButton} />
      <Stack>
        <HelpStrip storageKey="engage-announcements">
          Announcements show on the Employee Home banner, replacing greytHR's product ads. When more than one active announcement matches an employee, the most specific scope wins (both location and department beats one beats org-wide), and ties break on the most recent start date.
        </HelpStrip>

        <Panel
          title="Latest Announcements"
          subtitle={announcements.length ? `${announcements.length} in total` : undefined}
          extra={
            announcements.length > 0 && (
              <Select
                aria-label="Filter by status"
                value={status}
                onChange={setStatus}
                style={{ width: 150 }}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "active", label: "Active" },
                  { value: "paused", label: "Paused" },
                ]}
              />
            )
          }
        >
          {isLoading ? (
            <Stack gap={space[4]}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5] }}>
                  <Skel w="40%" h={16} style={{ marginBottom: space[3] }} />
                  <Skel w="25%" h={12} />
                </div>
              ))}
            </Stack>
          ) : error ? (
            <EmptyState kind="error" description={apiErrorMessage(error, "We couldn't load announcements. Try again.")} onRetry={() => void refetch()} />
          ) : announcements.length === 0 ? (
            <EmptyState
              illustration="documents"
              title="There's no announcement here"
              description={'Add one by clicking "Add new" below. It will show on the Employee Home banner.'}
              action={
                <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
                  Add new
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState kind="no-results" compact action={<Button onClick={() => setStatus("all")}>Show all</Button>} />
          ) : (
            <Stack gap={space[4]}>
              {rows.map((row) => (
                <AnnouncementCard
                  key={row.id}
                  row={row}
                  scopeLabel={scopeLabel(row)}
                  onEdit={() => {
                    setEditing(row);
                    setModalOpen(true);
                  }}
                  onDelete={() => setDeleting(row)}
                />
              ))}
            </Stack>
          )}
        </Panel>
      </Stack>

      <AnnouncementDrawer open={modalOpen} editing={editing} onClose={() => setModalOpen(false)} />
      <ConfirmModal
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        loading={deleteMutation.isPending}
        danger
        title="Delete this announcement?"
        description={deleting ? `"${deleting.title}" will be removed and will no longer show on the Employee Home banner. This can't be undone.` : undefined}
        confirmLabel="Delete"
      />
    </>
  );
}
