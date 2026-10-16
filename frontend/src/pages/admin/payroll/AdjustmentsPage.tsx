import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Flex, Input, Modal, Segmented, Select, Space, Table, Tag, Typography, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import type { AdjustmentPreview, AdjustmentRow, PersonHit } from "../../../api/payroll";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { formatRupees } from "../../../lib/money";

const { Title, Text } = Typography;

// Payroll → Adjustments (Phase 6 P6-2). One-off earnings and deductions HR adds before a run, and the arrears a back-dated salary revision made. Adding one is
// previewed first. They are part of what a run approves, so a run approved before one was added has to be approved again. Nobody adds or cancels one for
// their own pay.

const STATUS_COLOR = { PENDING: "orange", CONSUMED: "green", CANCELLED: "default" } as const;

export function AdjustmentsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPermission("payroll.salary.edit");
  const [status, setStatus] = useState<"PENDING" | "CONSUMED" | "CANCELLED" | "ALL">("PENDING");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<AdjustmentRow | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["payroll", "adjustments", status, page], queryFn: () => payrollApi.listAdjustments({ status: status === "ALL" ? undefined : status, page, pageSize: 25 }) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll"] });

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Title level={3} style={{ margin: 0 }}>
          Payroll adjustments
        </Title>
        {canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
            Add an adjustment
          </Button>
        )}
      </Flex>
      <Text type="secondary">A bonus, a recovery, or arrears from a back-dated salary revision. Each is paid or taken in the next payroll run for that person. Until a run uses it, it can be cancelled.</Text>
      <Segmented value={status} onChange={(v) => { setStatus(v as typeof status); setPage(1); }} options={[{ value: "PENDING", label: "Waiting for a run" }, { value: "CONSUMED", label: "Used by a run" }, { value: "CANCELLED", label: "Cancelled" }, { value: "ALL", label: "All" }]} />
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the adjustments.")} />}
      <Table<AdjustmentRow>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        pagination={{ current: page, pageSize: 25, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
        columns={[
          { title: "Employee", render: (_, a) => <div><Text strong>{a.employeeName}</Text><div><Text type="secondary" style={{ fontSize: 12 }}>{a.employeeCode}</Text></div></div> },
          { title: "What", render: (_, a) => <div>{a.reason}{a.periodStart && <div><Text type="secondary" style={{ fontSize: 12 }}>For {formatDate(a.periodStart)} to {a.periodEnd ? formatDate(a.periodEnd) : ""}</Text></div>}</div> },
          { title: "Kind", render: (_, a) => <Space size={4}><Tag color={a.direction === "EARNING" ? "green" : "red"}>{a.direction === "EARNING" ? "Earning" : "Deduction"}</Tag>{a.source === "SALARY_ARREARS" && <Tag color="gold">Arrears</Tag>}</Space> },
          { title: "Amount", align: "right", render: (_, a) => `${a.direction === "DEDUCTION" ? "-" : ""}${formatRupees(a.amount)}` },
          { title: "Status", render: (_, a) => <div><Tag color={STATUS_COLOR[a.status]}>{a.status === "PENDING" ? "Waiting" : a.status === "CONSUMED" ? "Used" : "Cancelled"}</Tag>{a.cancelReason && <div><Text type="secondary" style={{ fontSize: 12 }}>{a.cancelReason}</Text></div>}</div> },
          { title: "", align: "right", render: (_, a) => (canEdit && a.status === "PENDING" ? <Button size="small" danger onClick={() => setCancelling(a)}>Cancel</Button> : null) },
        ]}
      />
      {adding && <AddModal onClose={() => setAdding(false)} onDone={refresh} />}
      {cancelling && <CancelModal row={cancelling} onClose={() => setCancelling(null)} onDone={refresh} />}
    </Flex>
  );
}

function AddModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [employeeId, setEmployeeId] = useState<string>();
  const [componentCode, setComponentCode] = useState<string>();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { data: components = [] } = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const usable = components.filter((c) => c.value && c.value.type !== "EMPLOYER_CONTRIBUTION");
  const component = usable.find((c) => c.code === componentCode);
  const input = employeeId && componentCode && component?.value && amount.trim() && reason.trim() ? { employeeId, componentCode, direction: component.value.type as "EARNING" | "DEDUCTION", amount: amount.trim(), reason: reason.trim() } : null;
  const preview = useMutation({ mutationFn: () => payrollApi.previewAdjustment(input!), onSuccess: () => setProblem(null), onError: (e) => setProblem(apiErrorMessage(e, "Could not check that.")) });
  const add = useMutation({
    mutationFn: () => payrollApi.addAdjustment(input!, preview.data!.fingerprint),
    onSuccess: () => { void message.success("Added."); onDone(); onClose(); },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not add it.")),
  });
  const p: AdjustmentPreview | undefined = preview.data;
  const edited = () => preview.reset();
  return (
    <Modal open title="Add an adjustment" width={620} onCancel={onClose} destroyOnHidden footer={p ? <Space><Button onClick={() => preview.reset()}>Back</Button><Button type="primary" loading={add.isPending} onClick={() => add.mutate()}>Add it</Button></Space> : <Space><Button onClick={onClose}>Cancel</Button><Button type="primary" disabled={!input} loading={preview.isPending} onClick={() => preview.mutate()}>Preview</Button></Space>}>
      {!p ? (
        <Space orientation="vertical" size={10} style={{ width: "100%" }}>
          <Select showSearch filterOption={false} style={{ width: "100%" }} placeholder="Who: type a name or employee code" value={employeeId} options={hits.map((h) => ({ value: h.employeeId, label: `${h.name} (${h.employeeCode})` }))} onSearch={(q) => { if (q.trim().length >= 2) void payrollApi.searchPeople(q.trim()).then(setHits); }} onChange={(v) => { setEmployeeId(v); edited(); }} />
          <Select showSearch style={{ width: "100%" }} placeholder="Which component" value={componentCode} options={usable.map((c) => ({ value: c.code, label: `${c.value!.name}: ${c.value!.type === "EARNING" ? "earning" : "deduction"}` }))} onChange={(v) => { setComponentCode(v); edited(); }} />
          <Input prefix="₹" value={amount} onChange={(e) => { setAmount(e.target.value); edited(); }} placeholder="5000" style={{ width: 220 }} />
          <Input.TextArea value={reason} onChange={(e) => { setReason(e.target.value); edited(); }} rows={2} maxLength={300} placeholder="Why" />
          {problem && <Alert type="error" showIcon title={problem} />}
        </Space>
      ) : (
        <Space orientation="vertical" size={10} style={{ width: "100%" }}>
          <Descriptions size="small" column={1} bordered items={[{ key: "e", label: "Who", children: p.employeeName }, { key: "c", label: "What", children: `${p.componentName}: ${p.direction === "EARNING" ? "an earning" : "a deduction"}` }, { key: "a", label: "Amount", children: formatRupees(p.amount) }, { key: "r", label: "Why", children: p.reason }]} />
          {p.alreadyPending.length > 0 && <Alert type="warning" showIcon title="They already have adjustments waiting" description={p.alreadyPending.map((x) => `${x.componentCode} ${x.direction === "DEDUCTION" ? "-" : ""}${formatRupees(x.amount)}: ${x.reason}`).join("; ")} />}
          <Alert type="info" showIcon title={p.effect} />
          {problem && <Alert type="error" showIcon title={problem} />}
        </Space>
      )}
    </Modal>
  );
}

function CancelModal({ row, onClose, onDone }: { row: AdjustmentRow; onClose: () => void; onDone: () => void }) {
  const [why, setWhy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const cancel = useMutation({ mutationFn: () => payrollApi.cancelAdjustment(row.id, why), onSuccess: () => { onDone(); onClose(); }, onError: (e) => setProblem(apiErrorMessage(e, "Could not cancel it.")) });
  return (
    <Modal open title={`Cancel ${row.reason}`} onCancel={onClose} okText="Cancel this adjustment" okButtonProps={{ danger: true, disabled: why.trim().length < 3, loading: cancel.isPending }} onOk={() => cancel.mutate()} destroyOnHidden>
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Text>{row.employeeName}: {row.direction === "DEDUCTION" ? "-" : ""}{formatRupees(row.amount)}</Text>
        <Input.TextArea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} maxLength={300} placeholder="Why" />
        {problem && <Alert type="error" showIcon title={problem} />}
      </Space>
    </Modal>
  );
}
