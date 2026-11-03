import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, Radio, Select, Space, Tabs } from "antd";
import { CheckOutlined, EyeOutlined, FileDoneOutlined, PlusOutlined, StopOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { LetterExtraField } from "@shared/constants/letters";
import * as lettersApi from "../../../../api/letters";
import * as parityApi from "../../../../api/parity";
import { useAuth } from "../../../../hooks/useAuth";
import { apiErrorMessage as errorMessage } from "../../../../lib/apiError";
import { ConfirmModal, DataTable, EmptyState, PageHeader, Panel, SideDrawer, StatusChip, toast, useIsPhone } from "../../../../ui";
import { fs, space, v } from "../../../../theme/tokens";
import { PeoplePicker } from "../../employee/parity/PeoplePicker";

// A-9 G3 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 12): prepare letters for one person or many at once, collect up to two signatures, issue them (the
// existing issue path files each one to the person's documents), or void one with a reason. Which templates appear is the server's decision: everything for a
// director; for anyone else only the templates a director allowed them, and never a letter that can carry pay.

type Status = parityApi.LetterRequest["status"];
const STATUS_LABEL: Record<Status, string> = { IN_PROGRESS: "In progress", ISSUED: "Completed", VOID: "Void" };

function openPdf(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function ExtraFieldInput({ field }: { field: LetterExtraField }) {
  if (field.type === "date") return <DatePicker style={{ width: "100%" }} />;
  if (field.type === "number" || field.type === "currency") return <InputNumber style={{ width: "100%" }} stringMode />;
  return <Input maxLength={2000} />;
}

function PrepareDrawer({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [clientKey] = useState(() => crypto.randomUUID());
  const [form] = Form.useForm();
  const templateId = Form.useWatch("templateId", form) as string | undefined;
  const audience = (Form.useWatch("audience", form) as "people" | "segment" | undefined) ?? "people";
  const preparable = useQuery({ queryKey: ["letter-requests", "templates"], queryFn: parityApi.preparableTemplates });
  const allTemplates = useQuery({ queryKey: ["letters", "templates"], queryFn: lettersApi.listTemplates });
  const segments = useQuery({ queryKey: ["segments"], queryFn: parityApi.listSegments, enabled: hasPermission("employee.segments.manage") });
  const fields = useMemo(() => allTemplates.data?.find((t) => t.id === templateId)?.extraFields ?? [], [allTemplates.data, templateId]);
  const prepare = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      const extraValues: Record<string, string> = {};
      for (const f of fields) {
        const raw = values[`extra_${f.key}`];
        if (raw === undefined || raw === null || raw === "") continue;
        extraValues[f.key] = dayjs.isDayjs(raw) ? raw.format("YYYY-MM-DD") : String(raw);
      }
      return parityApi.prepareLetters({
        clientKey,
        templateId: values.templateId as string,
        ...(audience === "segment" ? { segmentId: values.segmentId as string } : { employeeIds: values.employeeIds as string[] }),
        extraValues,
        remarks: (values.remarks as string | undefined)?.trim() || null,
        signatoryEmployeeIds: (values.signatories as string[] | undefined) ?? [],
      });
    },
    onSuccess: (out) => {
      toast.success(out.created > 0 ? `${out.created} letter${out.created === 1 ? "" : "s"} prepared.` : "Already prepared.");
      void queryClient.invalidateQueries({ queryKey: ["letter-requests"] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not prepare the letters.")),
  });
  return (
    <SideDrawer open title="Prepare letters" size="wide" onClose={onClose} formId="prepare-letters-form" primaryLabel="Prepare" primaryLoading={prepare.isPending}>
      <Form id="prepare-letters-form" form={form} layout="vertical" requiredMark={false} initialValues={{ audience: "people" }} onFinish={(values) => prepare.mutate(values)}>
        <Form.Item name="templateId" label="Letter" rules={[{ required: true, message: "Choose a letter." }]}>
          <Select
            loading={preparable.isLoading}
            options={(preparable.data ?? []).map((t) => ({ value: t.id, label: t.payFree ? t.name : `${t.name} (directors only: can carry pay)` }))}
            notFoundContent="No letters you may prepare. A director decides who prepares which letter."
          />
        </Form.Item>
        <Form.Item name="audience" label="For">
          <Radio.Group
            options={[
              { value: "people", label: "Chosen people" },
              ...(hasPermission("employee.segments.manage") ? [{ value: "segment", label: "A saved segment" }] : []),
            ]}
          />
        </Form.Item>
        {audience === "segment" ? (
          <Form.Item name="segmentId" label="Segment" rules={[{ required: true, message: "Choose a segment." }]} extra="Resolved when you press Prepare, inside your own scope.">
            <Select options={(segments.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.count})` }))} />
          </Form.Item>
        ) : (
          <Form.Item name="employeeIds" label="People" rules={[{ required: true, type: "array", min: 1, message: "Choose at least one person." }]}>
            <PeoplePicker />
          </Form.Item>
        )}
        {fields.map((f) => (
          <Form.Item key={f.key} name={`extra_${f.key}`} label={f.label} rules={f.required ? [{ required: true, message: `${f.label} is required.` }] : []}>
            <ExtraFieldInput field={f} />
          </Form.Item>
        ))}
        <Form.Item name="signatories" label="Signatories (up to two)" extra="Each one signs before the letter can be issued.">
          <PeoplePicker max={2} ariaLabel="Signatories" />
        </Form.Item>
        <Form.Item name="remarks" label="Remarks">
          <Input.TextArea rows={2} maxLength={500} showCount />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}

function RequestsTable({ status }: { status: Status }) {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [voiding, setVoiding] = useState<parityApi.LetterRequest | null>(null);
  const [reason, setReason] = useState("");
  const templates = useQuery({ queryKey: ["letter-requests", "templates"], queryFn: parityApi.preparableTemplates });
  const mayIssue = (templateId: string) => templates.data?.find((t) => t.id === templateId)?.mayIssue ?? false;
  const list = useQuery({ queryKey: ["letter-requests", status, page], queryFn: () => parityApi.listLetterRequests(status, page, 25) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["letter-requests"] });
  const act = useMutation({
    mutationFn: async (a: { kind: "sign"; id: string; position: number } | { kind: "issue"; id: string } | { kind: "preview"; id: string } | { kind: "void"; id: string; reason: string }) => {
      if (a.kind === "sign") return parityApi.signLetterRequest(a.id, a.position);
      if (a.kind === "issue") return parityApi.issueLetterRequest(a.id);
      if (a.kind === "void") return parityApi.voidLetterRequest(a.id, a.reason);
      openPdf(await parityApi.previewLetterRequest(a.id));
      return null;
    },
    onSuccess: (_r, a) => {
      if (a.kind === "issue") toast.success("Issued. It is filed to the person's documents.");
      if (a.kind === "void") {
        toast.success("Voided.");
        setVoiding(null);
        setReason("");
      }
      if (a.kind !== "preview") refresh();
    },
    onError: (err) => toast.error(errorMessage(err, "That did not work.")),
  });
  const actions = (r: parityApi.LetterRequest) => (
    <Space wrap onClick={(e) => e.stopPropagation()}>
      {r.status === "IN_PROGRESS" && <Button icon={<EyeOutlined />} onClick={() => act.mutate({ kind: "preview", id: r.id })}>Draft</Button>}
      {r.status === "IN_PROGRESS" &&
        r.signatories.filter((s) => s.isMe && s.status === "PENDING").map((s) => (
          <Button key={s.position} icon={<CheckOutlined />} onClick={() => act.mutate({ kind: "sign", id: r.id, position: s.position })}>
            Sign
          </Button>
        ))}
      {r.status === "IN_PROGRESS" && mayIssue(r.template.id) && (
        <Button type="primary" icon={<FileDoneOutlined />} disabled={r.signatories.some((s) => s.status !== "SIGNED")} onClick={() => act.mutate({ kind: "issue", id: r.id })}>
          Issue
        </Button>
      )}
      {r.status !== "VOID" && (
        <Button danger icon={<StopOutlined />} onClick={() => setVoiding(r)}>
          Void
        </Button>
      )}
    </Space>
  );
  const signatures = (r: parityApi.LetterRequest) => (r.signatories.length === 0 ? "None needed" : r.signatories.map((s) => `${s.name}: ${s.status === "SIGNED" ? "signed" : "pending"}`).join(", "));
  return (
    <>
      <DataTable<parityApi.LetterRequest>
        rowKey="id"
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        dataSource={list.data?.rows ?? []}
        empty={<EmptyState compact title={`No ${STATUS_LABEL[status].toLowerCase()} letters.`} description={null} />}
        pagination={{ current: page, pageSize: 25, total: list.data?.total ?? 0, onChange: setPage }}
        columns={[
          { title: "Person", key: "who", render: (_: unknown, r) => `${r.employee.fullName} (${r.employee.employeeCode})` },
          { title: "Letter", key: "tpl", render: (_: unknown, r) => r.template.name },
          { title: "Signatures", key: "sig", render: (_: unknown, r) => signatures(r) },
          { title: status === "ISSUED" ? "Reference / serial" : "Remarks", key: "ref", render: (_: unknown, r) => (status === "ISSUED" ? `${r.letter?.reference ?? "—"} / ${r.serial ?? "Not set"}` : status === "VOID" ? r.voidReason : (r.remarks ?? "—")) },
          { title: "", key: "actions", render: (_: unknown, r) => actions(r) },
        ]}
        mobile={{
          title: (r) => r.employee.fullName,
          subtitle: (r) => r.template.name,
          status: (r) => <StatusChip status={r.status} />,
          fields: [
            { label: "Signatures", render: signatures },
            { label: status === "ISSUED" ? "Reference" : "Remarks", render: (r) => (status === "ISSUED" ? (r.letter?.reference ?? "—") : (r.remarks ?? "—")) },
          ],
          actions,
        }}
      />
      <ConfirmModal
        open={!!voiding}
        title="Void this letter?"
        description={voiding?.status === "ISSUED" ? "The letter stays on record exactly as issued; the person's copy is taken out of their documents." : "It is kept on record as void, never deleted."}
        confirmLabel="Void"
        danger
        confirmDisabled={reason.trim().length < 3}
        loading={act.isPending}
        onCancel={() => setVoiding(null)}
        onConfirm={() => voiding && act.mutate({ kind: "void", id: voiding.id, reason: reason.trim() })}
      >
        <Input.TextArea aria-label="Reason" placeholder="Why (a few words)" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginTop: phone ? space[2] : space[3] }} />
      </ConfirmModal>
    </>
  );
}

export function LetterRequestsPage() {
  const phone = useIsPhone();
  const [preparing, setPreparing] = useState(false);
  const [tab, setTab] = useState<Status>("IN_PROGRESS");
  const toSign = useQuery({ queryKey: ["letter-requests", "to-sign"], queryFn: parityApi.lettersToSign });
  return (
    <>
      <PageHeader
        title="Letters"
        subtitle="Prepare, sign and issue letters for one person or many"
        actions={
          <Button size="large" type="primary" icon={<PlusOutlined />} onClick={() => setPreparing(true)} style={phone ? { flex: 1 } : undefined}>
            Prepare letters
          </Button>
        }
      />
      {(toSign.data?.length ?? 0) > 0 && (
        <Panel title="Waiting for your signature">
          <p style={{ margin: 0, color: v.textSecondary, fontSize: fs.sm }}>{toSign.data!.length} letter{toSign.data!.length === 1 ? "" : "s"} — open In progress and press Sign on each.</p>
        </Panel>
      )}
      <Panel>
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as Status)}
          items={(["IN_PROGRESS", "ISSUED", "VOID"] as const).map((s) => ({ key: s, label: STATUS_LABEL[s], children: tab === s ? <RequestsTable status={s} /> : null }))}
        />
      </Panel>
      {preparing && <PrepareDrawer onClose={() => setPreparing(false)} />}
    </>
  );
}
