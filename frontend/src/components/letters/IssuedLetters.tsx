import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Flex, Form, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import { CheckCircleOutlined, FileAddOutlined, LockOutlined, RedoOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import * as lettersApi from "../../api/letters";
import type { IssuedLetter, LetterTemplateSummary } from "../../api/letters";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";
import { ExtraFieldInputs } from "./LetterFields";
import { stringifyExtras } from "./letterUtils";

const { Text } = Typography;
const STATUS: Record<IssuedLetter["status"], { color: string; label: string }> = {
  QUEUED: { color: "processing", label: "Generating…" },
  GENERATED: { color: "green", label: "Issued" },
  FAILED: { color: "red", label: "Failed" },
};

// Employee profile → Documents: issue a letter, and every letter issued to
// this employee. Issued letters are never edited or replaced: Reissue makes
// a new one; Reproduce re-renders from what was stored and checks it matches.
// Refreshes live when a queued letter finishes (letter.updated).
export function IssuedLetters({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const [issuing, setIssuing] = useState<{ reissueOf: IssuedLetter | null } | null>(null);
  const [form] = Form.useForm<{ templateId: string; visibleToEmployee: boolean; extraValues?: Record<string, unknown> }>();
  const templateId = Form.useWatch("templateId", form);
  const { data: letters = [], isLoading } = useQuery({ queryKey: ["letters", "employee", employeeId], queryFn: () => lettersApi.listEmployeeLetters(employeeId) });
  const { data: templates = [] } = useQuery({ queryKey: ["letters", "templates"], queryFn: lettersApi.listTemplates, enabled: issuing !== null });
  const active = templates.filter((t) => t.isActive);
  const chosen: LetterTemplateSummary | undefined = templates.find((t) => t.id === (issuing?.reissueOf?.template.id ?? templateId));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["letters", "employee", employeeId] });
    void queryClient.invalidateQueries({ queryKey: ["documents", "employee", employeeId] });
  };
  const issue = useMutation({
    mutationFn: (v: { templateId: string; visibleToEmployee: boolean; extraValues?: Record<string, unknown> }) =>
      issuing?.reissueOf
        ? lettersApi.reissueLetter(issuing.reissueOf.id, { extraValues: stringifyExtras(v.extraValues), visibleToEmployee: v.visibleToEmployee })
        : lettersApi.issueLetter(employeeId, { templateId: v.templateId, extraValues: stringifyExtras(v.extraValues), visibleToEmployee: v.visibleToEmployee }),
    onSuccess: (l) => {
      refresh();
      setIssuing(null);
      form.resetFields();
      void message.success(`${l.reference} is being generated — it'll appear here in a moment.`);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't issue the letter.")),
  });
  const reproduce = useMutation({
    mutationFn: (id: string) => lettersApi.reproduceLetter(id),
    onSuccess: ({ pdf, matches }) => {
      lettersApi.openPdf(pdf);
      if (matches) void message.success("Reproduced — identical to the letter that was issued.");
      else void message.warning("Re-rendered, but it isn't byte-identical (the PDF renderer has changed since). The stored original remains the record of what was sent.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't reproduce the letter.")),
  });

  function open(reissueOf: IssuedLetter | null) {
    setIssuing({ reissueOf });
    form.setFieldsValue({
      templateId: reissueOf?.template.id,
      visibleToEmployee: reissueOf?.visibleToEmployee ?? true,
      extraValues: reissueOf?.extraValues ?? {},
    });
  }

  return (
    <Flex vertical gap={8}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Text strong>Issued letters</Text>
        <Button icon={<FileAddOutlined />} onClick={() => open(null)}>
          Issue a letter
        </Button>
      </Flex>
      <Table<IssuedLetter>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={letters}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        scroll={{ x: true }}
        locale={{ emptyText: "No letters issued yet." }}
        columns={[
          { title: "Reference", dataIndex: "reference", render: (v: string, l) => (<span>{v}{l.reissueOf && <Text type="secondary" style={{ fontSize: 12 }}> · reissue of {l.reissueOf.reference}</Text>}</span>) },
          { title: "Letter", key: "template", render: (_: unknown, l) => `${l.template.name} (v${l.templateVersion})` },
          { title: "Issued", dataIndex: "generatedAt", render: (v: string) => formatDateTime(v) },
          {
            title: "Status",
            dataIndex: "status",
            render: (s: IssuedLetter["status"], l) =>
              s === "FAILED" ? (
                <Tooltip title={l.failureReason}>
                  <Tag color="red">Failed</Tag>
                </Tooltip>
              ) : (
                <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag>
              ),
          },
          { title: "Employee sees it", dataIndex: "visibleToEmployee", render: (v: boolean) => (v ? <CheckCircleOutlined /> : "HR only") },
          {
            title: "",
            key: "actions",
            render: (_: unknown, l) =>
              l.contentsWithheld ? (
                <Tooltip title="Letters can contain pay figures, so only people who can see pay documents can open, reissue or reproduce them.">
                  <Tag icon={<LockOutlined />}>Contents restricted</Tag>
                </Tooltip>
              ) : (
              <Space size={4}>
                {l.status === "GENERATED" && (
                  <Tooltip title="Re-render from what was stored and check it matches the issued PDF">
                    <Button size="small" icon={<SafetyCertificateOutlined />} loading={reproduce.isPending && reproduce.variables === l.id} onClick={() => reproduce.mutate(l.id)}>
                      Reproduce
                    </Button>
                  </Tooltip>
                )}
                <Tooltip title="Issue a corrected copy as a NEW letter; this one stays as issued">
                  <Button size="small" icon={<RedoOutlined />} onClick={() => open(l)}>
                    Reissue
                  </Button>
                </Tooltip>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={issuing?.reissueOf ? `Reissue ${issuing.reissueOf.reference}` : "Issue a letter"}
        open={issuing !== null}
        onCancel={() => setIssuing(null)}
        onOk={() => form.submit()}
        okText={issuing?.reissueOf ? "Reissue as a new letter" : "Issue"}
        confirmLoading={issue.isPending}
        destroyOnHidden
      >
        {issuing?.reissueOf && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={`${issuing.reissueOf.reference} stays exactly as issued.`}
            description="The reissue is a new letter with a new reference, using the template's current wording and today's details."
          />
        )}
        <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => issue.mutate(v)}>
          <Form.Item name="templateId" label="Letter" rules={[{ required: true, message: "Choose a letter." }]}>
            <Select
              disabled={Boolean(issuing?.reissueOf)}
              placeholder="Choose a letter"
              options={(issuing?.reissueOf ? templates : active).map((t) => ({ value: t.id, label: `${t.name} (v${t.currentVersion})` }))}
              onChange={(id: string) => form.setFieldValue("visibleToEmployee", templates.find((t) => t.id === id)?.visibleToEmployeeDefault ?? true)}
            />
          </Form.Item>
          {chosen && <ExtraFieldInputs fields={chosen.extraFields} />}
          <Form.Item name="visibleToEmployee" valuePropName="checked">
            <Checkbox>Visible to the employee (they're notified, and it appears in their Document Center)</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  );
}
