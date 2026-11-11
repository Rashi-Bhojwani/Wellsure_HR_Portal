import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input } from "antd";
import * as settingsApi from "../../../api/settings";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, space, v } from "../../../theme/tokens";
import { Panel, QueryState, SideDrawer, SkeletonCard, StatusChip, toast } from "../../../ui";

// NT-08 (M session): the wording of the sign-in emails. The greeting and the link button are always added; this edits only the subject, heading and
// paragraphs (plain text; a blank line starts a new paragraph). The security-change notice is not editable.
export function EmailTemplatesCard() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<settingsApi.EmailTemplate | null>(null);
  const [form] = Form.useForm<settingsApi.EmailText>();
  const q = useQuery({ queryKey: ["settings", "email-templates"], queryFn: settingsApi.listEmailTemplates });
  const save = useMutation({
    mutationFn: (a: { key: settingsApi.EmailTemplateKey; text: settingsApi.EmailText | null }) => settingsApi.updateEmailTemplate(a.key, a.text),
    onSuccess: (data) => { queryClient.setQueryData(["settings", "email-templates"], data); setEditing(null); toast.success("Saved. Emails sent from now on use it."); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save it.")),
  });
  return (
    <Panel title="Sign-in emails" subtitle="The wording of the invitation, password reset and welcome emails. The greeting and the link are always added for you. The security-change notice cannot be edited.">
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} skeleton={<SkeletonCard lines={3} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
          {(q.data ?? []).map((t) => (
            <div key={t.key} style={{ display: "flex", gap: space[3], flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: v.textPrimary }}>{t.label} <StatusChip tone={t.isDefault ? "info" : "success"}>{t.isDefault ? "Default, change in settings" : "Changed"}</StatusChip></div>
                <div style={{ color: v.textSecondary, fontSize: fs.sm }}>Subject: {t.text.subject}</div>
              </div>
              <Button onClick={() => { form.setFieldsValue(t.text); setEditing(t); }}>Edit</Button>
            </div>
          ))}
        </div>
      </QueryState>
      <SideDrawer
        open={!!editing}
        title={editing ? editing.label : ""}
        subtitle={editing ? `Placeholders you can use: ${editing.placeholders.map((p) => `{{${p}}}`).join(", ")}. Every change is recorded in the audit log.` : undefined}
        onClose={() => setEditing(null)}
        formId="email-template-form"
        primaryLabel="Save"
        primaryLoading={save.isPending}
      >
        <Form id="email-template-form" form={form} layout="vertical" requiredMark={false} onFinish={(text) => editing && save.mutate({ key: editing.key, text })}>
          <Form.Item name="subject" label="Subject" rules={[{ required: true, min: 3 }]}><Input maxLength={150} /></Form.Item>
          <Form.Item name="heading" label="Heading" rules={[{ required: true, min: 3 }]}><Input maxLength={100} /></Form.Item>
          <Form.Item name="body" label="Paragraphs (plain text; a blank line starts a new paragraph)" rules={[{ required: true, min: 3 }]}><Input.TextArea rows={6} maxLength={2000} /></Form.Item>
          {editing && !editing.isDefault && (
            <Button onClick={() => save.mutate({ key: editing.key, text: null })} loading={save.isPending}>Go back to the built-in wording</Button>
          )}
        </Form>
      </SideDrawer>
    </Panel>
  );
}
