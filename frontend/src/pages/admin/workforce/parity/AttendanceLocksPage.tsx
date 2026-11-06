import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, DatePicker, Form, Input, Radio, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as parityApi from "../../../../api/parity";
import * as workforceApi from "../../../../api/workforce";
import type { AttendanceLockView } from "../../../../api/workforce";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ConfirmModal, DataTable, PageHeader, SideDrawer, StatusChip, toast, useIsPhone } from "../../../../ui";
import { fs, space, v } from "../../../../theme/tokens";

// A-10 G3 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 7): directors lock chosen attendance activities for a date range, from an effective date, for everyone or
// the people of a saved segment (taken when the lock is made). A lock is never edited or deleted: it is voided with a reason, and a new one made.

const STATE_TEXT: Record<AttendanceLockView["state"], { text: string; tone: "success" | "info" | "neutral" }> = {
  IN_FORCE: { text: "In force", tone: "success" },
  SCHEDULED: { text: "Not yet in force", tone: "info" },
  VOID: { text: "Void", tone: "neutral" },
};
const fmt = (s: string) => dayjs(s).format("D MMM YYYY");

interface FormValues {
  effectiveFrom: Dayjs;
  range: [Dayjs, Dayjs];
  categories: string[];
  who: "ALL" | "SEGMENT";
  segmentId?: string;
  reason: string;
}

export function AttendanceLocksPage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<AttendanceLockView | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [form] = Form.useForm<FormValues>();
  const who = Form.useWatch("who", form);
  const locks = useQuery({ queryKey: ["workforce", "locks"], queryFn: workforceApi.listLocks });
  const segments = useQuery({ queryKey: ["segments"], queryFn: parityApi.listSegments, enabled: adding });
  const label = new Map((locks.data?.categories ?? []).map((c) => [c.code, c.label]));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["workforce", "locks"] });
  const create = useMutation({
    mutationFn: (val: FormValues) =>
      workforceApi.createLock({
        effectiveFrom: val.effectiveFrom.format("YYYY-MM-DD"),
        fromDate: val.range[0].format("YYYY-MM-DD"),
        toDate: val.range[1].format("YYYY-MM-DD"),
        categories: val.categories,
        segmentId: val.who === "SEGMENT" ? (val.segmentId ?? null) : null,
        reason: val.reason.trim(),
      }),
    onSuccess: () => {
      toast.success("Lock saved.");
      setAdding(false);
      form.resetFields();
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the lock.")),
  });
  const doVoid = useMutation({
    mutationFn: () => workforceApi.voidLock(voiding!.id, voidReason.trim()),
    onSuccess: () => {
      toast.success("Lock voided.");
      setVoiding(null);
      setVoidReason("");
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not void the lock.")),
  });

  return (
    <>
      <PageHeader
        title="Attendance Locks"
        subtitle="Stop chosen attendance activities for a range of days. Directors are not stopped; finalised periods are not affected."
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
            New lock
          </Button>
        }
      />
      <DataTable<AttendanceLockView>
        rowKey="id"
        loading={locks.isLoading}
        error={locks.error}
        onRetry={() => void locks.refetch()}
        dataSource={locks.data?.locks ?? []}
        empty="No locks. Nothing is locked."
        pagination={{ pageSize: 20 }}
        columns={[
          { title: "Days", key: "days", render: (_, r) => `${fmt(r.fromDate)} – ${fmt(r.toDate)}` },
          { title: "Activities", key: "cats", render: (_, r) => r.categories.map((c) => label.get(c) ?? c).join(", ") },
          { title: "Who", key: "who", render: (_, r) => (r.everyone ? "Everyone" : `${r.segmentName ?? "A segment"} (${r.people})`) },
          { title: "From", dataIndex: "effectiveFrom", render: (x: string) => fmt(x) },
          { title: "Reason", dataIndex: "reason", render: (x: string, r) => (r.voidReason ? `${x} · Voided: ${r.voidReason}` : x) },
          { title: "State", key: "state", render: (_, r) => <StatusChip tone={STATE_TEXT[r.state].tone}>{STATE_TEXT[r.state].text}</StatusChip> },
          {
            title: "",
            key: "act",
            render: (_, r) =>
              r.state === "VOID" ? null : (
                <Button size={phone ? "large" : "middle"} onClick={() => setVoiding(r)}>
                  Void
                </Button>
              ),
          },
        ]}
      />
      <SideDrawer open={adding} title="New lock" subtitle="Saved at once, with your reason, in the audit log." onClose={() => setAdding(false)} formId="lock-form" primaryLabel="Save lock" primaryLoading={create.isPending}>
        <Form id="lock-form" form={form} layout="vertical" requiredMark={false} initialValues={{ who: "ALL", effectiveFrom: dayjs() }} onFinish={(val) => create.mutate(val)}>
          <Form.Item name="range" label="Attendance days locked" rules={[{ required: true, message: "Choose the days" }]}>
            <DatePicker.RangePicker format="D MMM YYYY" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="effectiveFrom" label="In force from" rules={[{ required: true, message: "Choose a date" }]}>
            <DatePicker format="D MMM YYYY" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="categories" label="Activities" rules={[{ required: true, message: "Choose at least one" }]}>
            <Checkbox.Group style={{ display: "flex", flexDirection: "column", gap: space[2] }} options={(locks.data?.categories ?? []).map((c) => ({ value: c.code, label: c.label }))} />
          </Form.Item>
          <Form.Item name="who" label="For">
            <Radio.Group options={[{ value: "ALL", label: "Everyone" }, { value: "SEGMENT", label: "A saved segment" }]} />
          </Form.Item>
          {who === "SEGMENT" && (
            <Form.Item name="segmentId" label="Segment" extra="The people in it now are taken; later changes to the segment do not change the lock." rules={[{ required: true, message: "Choose a segment" }]}>
              <Select loading={segments.isLoading} options={(segments.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.count})` }))} />
            </Form.Item>
          )}
          <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 3, message: "Say why (a few words)" }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </SideDrawer>
      <ConfirmModal
        open={!!voiding}
        title="Void this lock?"
        description="It stops at once. It stays in the list as void, with your reason."
        confirmLabel="Void"
        confirmDisabled={voidReason.trim().length < 3}
        loading={doVoid.isPending}
        onCancel={() => setVoiding(null)}
        onConfirm={() => doVoid.mutate()}
      >
        <Input.TextArea aria-label="Reason" placeholder="Why (a few words)" rows={2} maxLength={300} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} style={{ marginTop: space[2], fontSize: fs.md, color: v.textBody }} />
      </ConfirmModal>
    </>
  );
}
