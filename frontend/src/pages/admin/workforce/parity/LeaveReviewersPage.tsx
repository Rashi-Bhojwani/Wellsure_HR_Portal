import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as leaveApi from "../../../../api/leave";
import * as orgApi from "../../../../api/org";
import * as workforceApi from "../../../../api/workforce";
import { EmployeePicker } from "../../../../components/letters/LetterFields";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ConfirmModal, DataTable, PageHeader, SideDrawer, StatusChip, toast } from "../../../../ui";
import { space } from "../../../../theme/tokens";

// A-10 G4 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 11): directors name a person who may also decide one leave type, for everyone or for one location
// and/or department. It only adds who can decide; the person also needs the "Approve leave" key. Removing one keeps it in the list as removed.

interface ReviewerForm {
  leaveTypeId: string;
  reviewerEmployeeId: string;
  locationId?: string;
  departmentId?: string;
  reason: string;
}

export function LeaveReviewersPage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<workforceApi.ReviewerView | null>(null);
  const [reason, setReason] = useState("");
  const [form] = Form.useForm<ReviewerForm>();
  const rows = useQuery({ queryKey: ["workforce", "reviewers"], queryFn: workforceApi.listReviewers });
  const types = useQuery({ queryKey: ["leave", "types"], queryFn: leaveApi.listLeaveTypes, enabled: adding });
  const locations = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations(), enabled: adding });
  const departments = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list, enabled: adding });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["workforce", "reviewers"] });
  const create = useMutation({
    mutationFn: (v: ReviewerForm) => workforceApi.createReviewer({ ...v, locationId: v.locationId ?? null, departmentId: v.departmentId ?? null, reason: v.reason.trim() }),
    onSuccess: () => {
      toast.success("Reviewer added.");
      setAdding(false);
      form.resetFields();
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not add the reviewer.")),
  });
  const remove = useMutation({
    mutationFn: () => workforceApi.voidReviewer(removing!.id, reason.trim()),
    onSuccess: () => {
      toast.success("Removed.");
      setRemoving(null);
      setReason("");
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not remove it.")),
  });
  return (
    <>
      <PageHeader title="Leave Reviewers" subtitle="People who may also decide one leave type, for everyone or one location or department." actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Add reviewer</Button>} />
      <DataTable<workforceApi.ReviewerView>
        rowKey="id"
        loading={rows.isLoading}
        error={rows.error}
        onRetry={() => void rows.refetch()}
        dataSource={rows.data ?? []}
        empty="No leave reviewers. Requests go to managers and HR as usual."
        pagination={{ pageSize: 20 }}
        columns={[
          { title: "Leave type", dataIndex: "leaveType" },
          { title: "Reviewer", dataIndex: "reviewerCode" },
          { title: "For", key: "for", render: (_, r) => [r.location, r.department].filter(Boolean).join(" · ") || "Everyone" },
          { title: "Added", dataIndex: "createdAt", render: (x: string) => dayjs(x).format("D MMM YYYY") },
          { title: "Reason", dataIndex: "reason", render: (x: string, r) => (r.voidReason ? `${x} · Removed: ${r.voidReason}` : x) },
          { title: "State", key: "state", render: (_, r) => <StatusChip tone={r.voidedAt ? "neutral" : "success"}>{r.voidedAt ? "Removed" : "Active"}</StatusChip> },
          { title: "", key: "act", render: (_, r) => (r.voidedAt ? null : <Button onClick={() => setRemoving(r)}>Remove</Button>) },
        ]}
      />
      <SideDrawer open={adding} title="Add a leave reviewer" subtitle="Saved at once, with your reason, in the audit log." onClose={() => setAdding(false)} formId="reviewer-form" primaryLabel="Add" primaryLoading={create.isPending}>
        <Form id="reviewer-form" form={form} layout="vertical" requiredMark={false} onFinish={(v) => create.mutate(v)}>
          <Form.Item name="leaveTypeId" label="Leave type" rules={[{ required: true, message: "Choose a leave type" }]}>
            <Select loading={types.isLoading} options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
          </Form.Item>
          <Form.Item name="reviewerEmployeeId" label="Reviewer" extra="They also need the Approve leave key to decide anything." rules={[{ required: true, message: "Choose a person" }]}>
            <EmployeePicker />
          </Form.Item>
          <Form.Item name="locationId" label="Only for a location (optional)">
            <Select allowClear loading={locations.isLoading} options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />
          </Form.Item>
          <Form.Item name="departmentId" label="Only for a department (optional)">
            <Select allowClear loading={departments.isLoading} options={(departments.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          </Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 3, message: "Say why (a few words)" }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </SideDrawer>
      <ConfirmModal open={!!removing} title="Remove this reviewer?" description="They stop deciding this leave type at once." confirmLabel="Remove" confirmDisabled={reason.trim().length < 3} loading={remove.isPending} onCancel={() => setRemoving(null)} onConfirm={() => remove.mutate()}>
        <Input.TextArea aria-label="Reason" placeholder="Why (a few words)" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginTop: space[2] }} />
      </ConfirmModal>
    </>
  );
}
