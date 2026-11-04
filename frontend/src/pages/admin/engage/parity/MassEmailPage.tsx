import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Radio, Select, Space, Tabs } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, SendOutlined } from "@ant-design/icons";
import * as parityApi from "../../../../api/parity";
import { useAuth } from "../../../../hooks/useAuth";
import { apiErrorMessage as errorMessage } from "../../../../lib/apiError";
import { ConfirmModal, DataTable, EmptyState, PageHeader, Panel, SideDrawer, StatusChip, toast, useIsPhone } from "../../../../ui";
import { PeoplePicker } from "../../employee/parity/PeoplePicker";

// A-9 G5 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 15): an email to everyone, a saved segment or chosen people. Email only. A draft can be changed or
// discarded; before sending, the server counts who it will reach (inside your own scope, current staff only) and the send goes ahead only if that number is
// still the one you saw. The text is plain and may not carry pay figures or identity numbers.

const AUDIENCE: Record<parityApi.MassEmail["audience"], string> = { ALL: "Everyone you can see", SEGMENT: "A saved segment", PEOPLE: "Chosen people" };

function ComposeDrawer({ editing, onClose }: { editing: parityApi.MassEmail | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [form] = Form.useForm();
  const audience = (Form.useWatch("audience", form) as parityApi.MassEmail["audience"] | undefined) ?? editing?.audience ?? "ALL";
  const segments = useQuery({ queryKey: ["segments"], queryFn: parityApi.listSegments, enabled: hasPermission("employee.segments.manage") });
  const save = useMutation({
    mutationFn: (values: { subject: string; body: string; category?: string; audience: parityApi.MassEmail["audience"]; segmentId?: string; employeeIds?: string[] }) => {
      const base = { subject: values.subject, body: values.body, category: values.category?.trim() || null };
      const who = values.audience === "SEGMENT" ? { audience: "SEGMENT" as const, segmentId: values.segmentId! } : values.audience === "PEOPLE" ? { audience: "PEOPLE" as const, employeeIds: values.employeeIds! } : { audience: "ALL" as const };
      return editing ? parityApi.updateMassEmail(editing.id, { ...base, ...who }) : parityApi.createMassEmail({ ...base, ...who });
    },
    onSuccess: () => {
      toast.success("Draft saved. Send it from the Drafts list.");
      void queryClient.invalidateQueries({ queryKey: ["mass-email"] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save the draft.")),
  });
  return (
    <SideDrawer open title={editing ? "Edit draft" : "New email"} size="wide" onClose={onClose} formId="mass-email-form" primaryLabel="Save draft" primaryLoading={save.isPending}>
      <Form
        id="mass-email-form"
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={editing ? { subject: editing.subject, body: editing.body, category: editing.category ?? "", audience: editing.audience, segmentId: editing.segmentId ?? undefined, employeeIds: editing.employeeIds } : { audience: "ALL" }}
        onFinish={(values) => save.mutate(values)}
      >
        <Form.Item name="subject" label="Subject" rules={[{ required: true, whitespace: true, message: "Write a subject." }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="category" label="Category (optional)" extra="Your own word for what kind of message this is, for the history.">
          <Input maxLength={60} />
        </Form.Item>
        <Form.Item name="body" label="Message" rules={[{ required: true, whitespace: true, message: "Write the message." }]} extra="Plain text. Never pay figures, account or identity numbers: the message is refused if it has any.">
          <Input.TextArea rows={8} maxLength={20000} />
        </Form.Item>
        <Form.Item name="audience" label="To">
          <Radio.Group options={(Object.keys(AUDIENCE) as Array<keyof typeof AUDIENCE>).filter((k) => k !== "SEGMENT" || hasPermission("employee.segments.manage")).map((k) => ({ value: k, label: AUDIENCE[k] }))} />
        </Form.Item>
        {audience === "SEGMENT" && (
          <Form.Item name="segmentId" label="Segment" rules={[{ required: true, message: "Choose a segment." }]}>
            <Select options={(segments.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          </Form.Item>
        )}
        {audience === "PEOPLE" && (
          <Form.Item name="employeeIds" label="People" rules={[{ required: true, type: "array", min: 1, message: "Choose at least one person." }]}>
            <PeoplePicker />
          </Form.Item>
        )}
      </Form>
    </SideDrawer>
  );
}

function EmailList({ status, onEdit }: { status: "DRAFT" | "SENT"; onEdit: (e: parityApi.MassEmail) => void }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ email: parityApi.MassEmail; count: number; withoutAddress: number } | null>(null);
  const [discarding, setDiscarding] = useState<parityApi.MassEmail | null>(null);
  const list = useQuery({ queryKey: ["mass-email", status, page], queryFn: () => parityApi.listMassEmails(status, page) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["mass-email"] });
  const count = useMutation({ mutationFn: async (e: parityApi.MassEmail) => ({ email: e, ...(await parityApi.countMassEmail(e.id)) }), onSuccess: setConfirm, onError: (err) => toast.error(errorMessage(err, "Could not count the audience.")) });
  const send = useMutation({
    mutationFn: (c: { email: parityApi.MassEmail; count: number }) => parityApi.sendMassEmail(c.email.id, c.count),
    onSuccess: (e) => {
      toast.success(`Sent to ${e.deliveredCount ?? 0} of ${e.recipientCount ?? 0}.`);
      setConfirm(null);
      refresh();
    },
    onError: (err) => {
      toast.error(errorMessage(err, "Not sent."));
      setConfirm(null);
    },
  });
  const discard = useMutation({
    mutationFn: (id: string) => parityApi.discardMassEmail(id),
    onSuccess: () => {
      toast.success("Discarded.");
      setDiscarding(null);
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not discard it.")),
  });
  const actions = (e: parityApi.MassEmail) =>
    e.status === "DRAFT" ? (
      <Space wrap onClick={(ev) => ev.stopPropagation()}>
        <Button icon={<EditOutlined />} onClick={() => onEdit(e)}>
          Edit
        </Button>
        <Button type="primary" icon={<SendOutlined />} loading={count.isPending && count.variables?.id === e.id} onClick={() => count.mutate(e)}>
          Send
        </Button>
        <Button danger icon={<DeleteOutlined />} aria-label={`Discard ${e.subject}`} onClick={() => setDiscarding(e)} />
      </Space>
    ) : null;
  return (
    <>
      <DataTable<parityApi.MassEmail>
        rowKey="id"
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        dataSource={list.data?.rows ?? []}
        empty={<EmptyState compact title={status === "DRAFT" ? "No drafts." : "Nothing sent yet."} description={null} />}
        pagination={{ current: page, pageSize: 25, total: list.data?.total ?? 0, onChange: setPage }}
        columns={[
          { title: "Subject", dataIndex: "subject", key: "s" },
          { title: "Category", dataIndex: "category", key: "c", render: (c: string | null) => c ?? "—" },
          { title: "To", dataIndex: "audience", key: "a", render: (a: parityApi.MassEmail["audience"]) => AUDIENCE[a] },
          status === "SENT"
            ? { title: "Sent", key: "r", render: (_: unknown, e: parityApi.MassEmail) => `${e.sentAt?.slice(0, 10) ?? ""} · ${e.deliveredCount ?? 0} of ${e.recipientCount ?? 0}${e.failedCount ? ` (${e.failedCount} failed)` : ""}` }
            : { title: "Saved", dataIndex: "createdAt", key: "r", render: (d: string) => d.slice(0, 10) },
          { title: "", key: "x", render: (_: unknown, e: parityApi.MassEmail) => actions(e) },
        ]}
        mobile={{
          title: (e) => e.subject,
          subtitle: (e) => AUDIENCE[e.audience],
          status: (e) => <StatusChip status={e.status} />,
          fields: [{ label: status === "SENT" ? "Reached" : "Saved", render: (e) => (status === "SENT" ? `${e.deliveredCount ?? 0} of ${e.recipientCount ?? 0}` : e.createdAt.slice(0, 10)) }],
          actions,
        }}
      />
      <ConfirmModal
        open={!!confirm}
        title={`Send to ${confirm?.count ?? 0} ${confirm?.count === 1 ? "person" : "people"}?`}
        description={confirm?.withoutAddress ? `${confirm.withoutAddress} of them have no email address on file and will be recorded as not reached.` : "It goes out now, by email only, and is recorded."}
        confirmLabel="Send"
        loading={send.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && send.mutate(confirm)}
      />
      <ConfirmModal open={!!discarding} title="Discard this draft?" description="It will not be sent. It is kept in the records." confirmLabel="Discard" danger loading={discard.isPending} onCancel={() => setDiscarding(null)} onConfirm={() => discarding && discard.mutate(discarding.id)} />
    </>
  );
}

export function MassEmailPage() {
  const phone = useIsPhone();
  const [composing, setComposing] = useState<{ editing: parityApi.MassEmail | null } | null>(null);
  const [tab, setTab] = useState<"DRAFT" | "SENT">("DRAFT");
  return (
    <>
      <PageHeader
        title="Mass Email"
        subtitle="Write to everyone, a segment or chosen people"
        actions={
          <Button size="large" type="primary" icon={<PlusOutlined />} onClick={() => setComposing({ editing: null })} style={phone ? { flex: 1 } : undefined}>
            New email
          </Button>
        }
      />
      <Panel>
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as "DRAFT" | "SENT")}
          items={[
            { key: "DRAFT", label: "Drafts", children: tab === "DRAFT" ? <EmailList status="DRAFT" onEdit={(e) => setComposing({ editing: e })} /> : null },
            { key: "SENT", label: "History", children: tab === "SENT" ? <EmailList status="SENT" onEdit={() => undefined} /> : null },
          ]}
        />
      </Panel>
      {composing && <ComposeDrawer editing={composing.editing} onClose={() => setComposing(null)} />}
    </>
  );
}
