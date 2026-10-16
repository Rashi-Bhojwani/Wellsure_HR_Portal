import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Flex, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Tooltip, Typography, message } from "antd";
import { EditOutlined, HistoryOutlined, PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { COMPONENT_TYPES, COMPONENT_TYPE_LABEL, ITEM_CODE_PATTERN } from "@shared/constants/payrollSalary";
import * as payrollApi from "../../../api/payroll";
import type { ComponentValue, ComponentView } from "../../../api/payroll";
import { ItemConfirmModal, ItemHistoryDrawer } from "../../../components/payroll/ItemDialogs";
import { ItemStatusTag } from "../../../components/payroll/ItemStatusTag";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { describeComponent } from "./salaryText";

const { Title, Text } = Typography;

// Payroll → Salary components (Phase 6 P6-2). A component says what a line IS: whether it is an earning or a deduction, and which tax and statutory
// treatments apply. How much each line gets is the structure's job. A component is a Placeholder until a different person confirms it; editing one adds
// the next version and nobody's pay moves until a structure and a salary revision pick it up.

const EMPTY: ComponentValue = { name: "", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: "", payslipOrder: 1 };

export function ComponentsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPermission("payroll.salary.edit");
  const canConfirm = hasPermission("payroll.rules.confirm");
  const [editing, setEditing] = useState<{ code: string | null; value: ComponentValue } | null>(null);
  const [confirming, setConfirming] = useState<ComponentView | null>(null);
  const [history, setHistory] = useState<ComponentView | null>(null);
  const { data = [], isLoading, error } = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll"] });

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Title level={3} style={{ margin: 0 }}>
          Salary components
        </Title>
        {canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ code: null, value: EMPTY })}>
            Add a component
          </Button>
        )}
      </Flex>
      <Text type="secondary">
        A component is one line of a salary: Basic, HRA, Special allowance, a deduction. It says what the line is and how it is treated for tax, PF and ESI. How much each line gets is set in the{" "}
        <Link to="/admin/payroll/structures">salary structure</Link>. PF, ESI, professional tax, LWF and TDS are not components: the calculation produces them from the rules.
      </Text>
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the components.")} />}
      <Table<ComponentView>
        rowKey="code"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        locale={{ emptyText: "No components yet. Add the lines your salaries are made of." }}
        columns={[
          {
            title: "Component",
            render: (_, c) => (
              <div>
                <Text strong>{c.value?.name}</Text>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {c.code}
                  </Text>
                </div>
              </div>
            ),
          },
          { title: "Kind", render: (_, c) => (c.value ? <Tag>{COMPONENT_TYPE_LABEL[c.value.type]}</Tag> : null) },
          {
            title: "Treated as",
            render: (_, c) => (
              <Space size={4} wrap>
                {c.value?.taxable && <Tag color="blue">Taxable</Tag>}
                {c.value?.pfApplicable && <Tag color="purple">PF</Tag>}
                {c.value?.esiApplicable && <Tag color="purple">ESI</Tag>}
                {c.value?.prorates && <Tag>Pro-rates with paid days</Tag>}
              </Space>
            ),
          },
          {
            title: "Status",
            render: (_, c) => (
              <Space orientation="vertical" size={2}>
                <ItemStatusTag status={c.status} sourceLabel={c.sourceLabel} />
                {c.lastConfirmed && <Text type="secondary" style={{ fontSize: 12 }}>Last confirmed: version {c.lastConfirmed.version}</Text>}
              </Space>
            ),
          },
          {
            title: "Used by",
            render: (_, c) =>
              c.usedBy.length === 0 ? (
                <Text type="secondary">No structure yet</Text>
              ) : (
                <Space orientation="vertical" size={0}>
                  {c.usedBy.map((u) => (
                    <Tooltip key={u.structure} title={u.behind ? `This structure uses version ${u.pinnedVersion}; a newer version exists. Save a new version of the structure to use it.` : undefined}>
                      <Text>
                        {u.structureName} {u.behind && <Tag color="gold">older version</Tag>}
                      </Text>
                    </Tooltip>
                  ))}
                </Space>
              ),
          },
          {
            title: "",
            align: "right",
            render: (_, c) => (
              <Space wrap>
                {canEdit && (
                  <Button size="small" icon={<EditOutlined />} onClick={() => setEditing({ code: c.code, value: c.value! })}>
                    Edit
                  </Button>
                )}
                {canConfirm && c.status === "PLACEHOLDER" && (
                  <Button size="small" type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setConfirming(c)}>
                    Confirm…
                  </Button>
                )}
                <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistory(c)}>
                  History
                </Button>
              </Space>
            ),
          },
        ]}
      />
      {editing && <EditModal initial={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {confirming && (
        <ItemConfirmModal
          title={`Confirm: ${confirming.value?.name}`}
          queryKey={["payroll", "component-confirm", confirming.code]}
          loadPreview={() => payrollApi.previewComponentConfirm(confirming.code)}
          confirm={(b) => payrollApi.confirmComponent(confirming.code, b)}
          renderValue={(p) => describeComponent(p.value)}
          onClose={() => setConfirming(null)}
          onDone={refresh}
        />
      )}
      {history && <ItemHistoryDrawer title={`History: ${history.value?.name}`} queryKey={["payroll", "component-history", history.code]} load={async () => (await payrollApi.getComponent(history.code)).history} renderValue={describeComponent} onClose={() => setHistory(null)} />}
    </Flex>
  );
}

function EditModal({ initial, onClose, onSaved }: { initial: { code: string | null; value: ComponentValue }; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm<ComponentValue & { code: string }>();
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const isNew = initial.code === null;
  const preview = useMutation({
    mutationFn: async () => {
      const v = await form.validateFields();
      const { code, ...value } = v;
      return { code: isNew ? code : initial.code!, value: value as ComponentValue, result: await payrollApi.previewComponentSave(isNew ? code : initial.code!, value as ComponentValue) };
    },
    onError: (err) => setProblem(apiErrorMessage(err, "Could not check that.")),
    onSuccess: () => setProblem(null),
  });
  const save = useMutation({
    mutationFn: () => payrollApi.saveComponent(preview.data!.code, { value: preview.data!.value, note, fingerprint: preview.data!.result.fingerprint }),
    onSuccess: () => {
      void message.success("Saved as an unconfirmed version.");
      onSaved();
      onClose();
    },
    onError: (err) => setProblem(apiErrorMessage(err, "Could not save.")),
  });
  const p = preview.data?.result;
  return (
    <Modal
      open
      width={620}
      title={isNew ? "Add a component" : `Edit ${initial.value.name}`}
      onCancel={onClose}
      destroyOnHidden
      footer={
        p ? (
          <Space>
            <Button onClick={() => preview.reset()}>Back</Button>
            <Button type="primary" loading={save.isPending} disabled={p.unchanged} onClick={() => save.mutate()}>
              Save as an unconfirmed version
            </Button>
          </Space>
        ) : (
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" loading={preview.isPending} onClick={() => preview.mutate()}>
              Preview
            </Button>
          </Space>
        )
      }
    >
      {!p ? (
        <Form form={form} layout="vertical" initialValues={{ ...initial.value, code: initial.code ?? "" }}>
          {isNew && (
            <Form.Item name="code" label="Code" extra="Capital letters, digits and underscores, for example BASIC. It cannot be changed later." rules={[{ required: true, pattern: ITEM_CODE_PATTERN, message: "Use capital letters, digits and underscores, starting with a letter" }]}>
              <Input placeholder="BASIC" maxLength={25} />
            </Form.Item>
          )}
          <Form.Item name="name" label="Name" rules={[{ required: true, min: 2, max: 60 }]}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item name="type" label="Kind" rules={[{ required: true }]}>
            <Select options={COMPONENT_TYPES.map((t) => ({ value: t, label: COMPONENT_TYPE_LABEL[t] }))} />
          </Form.Item>
          <Flex gap={24} wrap>
            <Form.Item name="taxable" label="Taxable" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="pfApplicable" label="PF applies" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="esiApplicable" label="ESI applies" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="prorates" label="Pro-rates with paid days" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Flex>
          <Flex gap={16} wrap>
            <Form.Item name="payslipLabel" label="Called on the payslip" rules={[{ required: true, max: 60 }]} style={{ flex: 1, minWidth: 200 }}>
              <Input maxLength={60} />
            </Form.Item>
            <Form.Item name="payslipOrder" label="Position on the payslip" rules={[{ required: true }]}>
              <InputNumber min={1} max={999} precision={0} />
            </Form.Item>
          </Flex>
          {problem && <Alert type="error" showIcon title={problem} />}
        </Form>
      ) : (
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Text strong>{describeComponent(p.after.value)}</Text>
          {p.before && <Text type="secondary">Now: version {p.before.version}, {p.before.status === "CONFIRMED" ? "Confirmed" : "Placeholder"}.</Text>}
          {p.unchanged && <Alert type="warning" showIcon title="That is the value it already has. There is nothing to save." />}
          {p.willResetConfirmation && <Alert type="warning" showIcon title="This component is Confirmed now." description="Saving adds a new version that is a Placeholder until a different person confirms it. The Confirmed version stays on record and in every structure that pinned it." />}
          <Alert type="info" showIcon title={p.impact} />
          <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Why this, and where it came from (optional, but the person who confirms it will want it)" />
          {problem && <Alert type="error" showIcon title={problem} />}
        </Space>
      )}
    </Modal>
  );
}
