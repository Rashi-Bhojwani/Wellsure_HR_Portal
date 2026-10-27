import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Select, Tooltip } from "antd";
import { CheckCircleOutlined, FileAddOutlined, LockOutlined, RedoOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import * as lettersApi from "../../api/letters";
import type { IssuedLetter, LetterTemplateSummary } from "../../api/letters";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";
import { ExtraFieldInputs } from "./LetterFields";
import { stringifyExtras } from "./letterUtils";
import { fs, fw, space, v } from "../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, SideDrawer, StatusChip, toast, useIsPhone, type ChipTone } from "../../ui";

const FORM_ID = "issue-letter-form";
const STATUS: Record<IssuedLetter["status"], { tone: ChipTone; label: string }> = {
  QUEUED: { tone: "info", label: "Generating…" },
  GENERATED: { tone: "success", label: "Issued" },
  FAILED: { tone: "danger", label: "Failed" },
};

function LetterStatus({ letter }: { letter: IssuedLetter }) {
  const s = STATUS[letter.status];
  const chip = <StatusChip tone={s.tone}>{s.label}</StatusChip>;
  return letter.status === "FAILED" && letter.failureReason ? (
    <Tooltip title={letter.failureReason}>
      <span tabIndex={0} aria-label={`Failed: ${letter.failureReason}`}>
        {chip}
      </span>
    </Tooltip>
  ) : (
    chip
  );
}

// Employee profile → Documents: issue a letter, and every letter issued to
// this employee. Issued letters are never edited or replaced: Reissue makes
// a new one; Reproduce re-renders from what was stored and checks it matches.
// Refreshes live when a queued letter finishes (letter.updated).
export function IssuedLetters({ employeeId }: { employeeId: string }) {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [issuing, setIssuing] = useState<{ reissueOf: IssuedLetter | null } | null>(null);
  const [form] = Form.useForm<{ templateId: string; visibleToEmployee: boolean; extraValues?: Record<string, unknown> }>();
  const templateId = Form.useWatch("templateId", form);
  const { data: letters = [], isLoading, error, refetch } = useQuery({ queryKey: ["letters", "employee", employeeId], queryFn: () => lettersApi.listEmployeeLetters(employeeId) });
  const { data: templates = [], isLoading: loadingTemplates } = useQuery({ queryKey: ["letters", "templates"], queryFn: lettersApi.listTemplates, enabled: issuing !== null });
  const active = templates.filter((t) => t.isActive);
  const chosen: LetterTemplateSummary | undefined = templates.find((t) => t.id === (issuing?.reissueOf?.template.id ?? templateId));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["letters", "employee", employeeId] });
    void queryClient.invalidateQueries({ queryKey: ["documents", "employee", employeeId] });
  };
  const issue = useMutation({
    mutationFn: (vals: { templateId: string; visibleToEmployee: boolean; extraValues?: Record<string, unknown> }) =>
      issuing?.reissueOf
        ? lettersApi.reissueLetter(issuing.reissueOf.id, { extraValues: stringifyExtras(vals.extraValues), visibleToEmployee: vals.visibleToEmployee })
        : lettersApi.issueLetter(employeeId, { templateId: vals.templateId, extraValues: stringifyExtras(vals.extraValues), visibleToEmployee: vals.visibleToEmployee }),
    onSuccess: (l) => {
      refresh();
      setIssuing(null);
      form.resetFields();
      toast.success(`${l.reference} is being generated — it'll appear here in a moment.`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't issue the letter.")),
  });
  const reproduce = useMutation({
    mutationFn: (id: string) => lettersApi.reproduceLetter(id),
    onSuccess: ({ pdf, matches }) => {
      lettersApi.openPdf(pdf);
      if (matches) toast.success("Reproduced — identical to the letter that was issued.");
      else toast.warning("Re-rendered, but it isn't byte-identical (the PDF renderer has changed since). The stored original remains the record of what was sent.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't reproduce the letter.")),
  });

  function open(reissueOf: IssuedLetter | null) {
    setIssuing({ reissueOf });
    form.setFieldsValue({
      templateId: reissueOf?.template.id,
      visibleToEmployee: reissueOf?.visibleToEmployee ?? true,
      extraValues: reissueOf?.extraValues ?? {},
    });
  }

  const actions = (l: IssuedLetter) =>
    l.contentsWithheld ? (
      <Tooltip title="Letters can contain pay figures, so only people who can see pay documents can open, reissue or reproduce them.">
        <span tabIndex={0}>
          <StatusChip tone="neutral" icon={<LockOutlined aria-hidden />}>
            Contents restricted
          </StatusChip>
        </span>
      </Tooltip>
    ) : (
      <span style={{ display: "inline-flex", gap: space[2], flexWrap: "wrap" }}>
        {l.status === "GENERATED" && (
          <Tooltip title="Re-render from what was stored and check it matches the issued PDF">
            <Button size={phone ? "middle" : "small"} icon={<SafetyCertificateOutlined />} loading={reproduce.isPending && reproduce.variables === l.id} onClick={() => reproduce.mutate(l.id)}>
              Reproduce
            </Button>
          </Tooltip>
        )}
        <Tooltip title="Issue a corrected copy as a NEW letter; this one stays as issued">
          <Button size={phone ? "middle" : "small"} icon={<RedoOutlined />} onClick={() => open(l)}>
            Reissue
          </Button>
        </Tooltip>
      </span>
    );
  const visible = (b: boolean) =>
    b ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: space[1], color: v.accentText }}>
        <CheckCircleOutlined aria-hidden /> Yes
      </span>
    ) : (
      "HR only"
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: space[2] }}>
        <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>Issued letters</span>
        <Button icon={<FileAddOutlined />} onClick={() => open(null)}>
          Issue a letter
        </Button>
      </div>
      <DataTable<IssuedLetter>
        rowKey="id"
        density="compact"
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        dataSource={letters}
        pagination={letters.length > 10 ? { pageSize: 10 } : false}
        empty={<EmptyState compact illustration="documents" title="No letters issued yet" description="Issue one from a template — it's added to the employee's documents." />}
        columns={[
          {
            title: "Reference",
            dataIndex: "reference",
            render: (ref: string, l) => (
              <span>
                {ref}
                {l.reissueOf && <span style={{ color: v.textSecondary, fontSize: fs.sm }}> · reissue of {l.reissueOf.reference}</span>}
              </span>
            ),
          },
          { title: "Letter", key: "template", render: (_: unknown, l) => `${l.template.name} (v${l.templateVersion})` },
          { title: "Issued", dataIndex: "generatedAt", render: (d: string) => formatDateTime(d) },
          { title: "Status", dataIndex: "status", render: (_: unknown, l) => <LetterStatus letter={l} /> },
          { title: "Employee sees it", dataIndex: "visibleToEmployee", render: (b: boolean) => visible(b) },
          { title: "", key: "actions", render: (_: unknown, l) => actions(l) },
        ]}
        mobile={{
          title: (l) => `${l.template.name} (v${l.templateVersion})`,
          subtitle: (l) => (l.reissueOf ? `${l.reference} · reissue of ${l.reissueOf.reference}` : l.reference),
          status: (l) => <LetterStatus letter={l} />,
          fields: [
            { label: "Issued", render: (l) => formatDateTime(l.generatedAt) },
            { label: "Employee sees it", render: (l) => visible(l.visibleToEmployee) },
          ],
          actions,
        }}
      />
      <SideDrawer
        open={issuing !== null}
        onClose={() => setIssuing(null)}
        title={issuing?.reissueOf ? `Reissue ${issuing.reissueOf.reference}` : "Issue a letter"}
        formId={FORM_ID}
        primaryLabel={issuing?.reissueOf ? "Reissue as a new letter" : "Issue"}
        primaryLoading={issue.isPending}
      >
        {issuing?.reissueOf && (
          <ApprovalBanner
            tone="info"
            style={{ marginBottom: space[4] }}
            title={`${issuing.reissueOf.reference} stays exactly as issued.`}
            description="The reissue is a new letter with a new reference, using the template's current wording and today's details."
          />
        )}
        <Form id={FORM_ID} form={form} layout="vertical" requiredMark onFinish={(vals) => issue.mutate(vals)}>
          <Form.Item name="templateId" label="Letter" rules={[{ required: true, message: "Choose a letter." }]}>
            <Select
              disabled={Boolean(issuing?.reissueOf)}
              loading={loadingTemplates}
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
      </SideDrawer>
    </div>
  );
}
