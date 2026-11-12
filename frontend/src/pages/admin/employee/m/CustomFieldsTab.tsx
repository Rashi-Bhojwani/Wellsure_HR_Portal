import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, Select } from "antd";
import { EditOutlined, EyeOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import * as api from "../../../../api/customFields";
import { useAuth } from "../../../../hooks/useAuth";
import { apiErrorMessage } from "../../../../lib/apiError";
import { EmptyState, KeyValueGrid, Panel, QueryState, SideDrawer, toast } from "../../../../ui";

// M session block 2, ER-28: the employee's custom fields on the profile. Shown when the company has any. HR (employee.edit) edits; a sensitive value
// shows masked, and a director may reveal it (audited). The server decides every value shown.
export function CustomFieldsTab({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [form] = Form.useForm<Record<string, unknown>>();
  const q = useQuery({ queryKey: ["custom-fields", "values", employeeId], queryFn: () => api.valuesOf(employeeId) });
  const save = useMutation({
    mutationFn: (vals: Record<string, unknown>) => {
      const out: Record<string, string | null> = {};
      for (const f of q.data ?? []) {
        const raw = vals[f.id];
        if (f.sensitive && (raw === undefined || raw === "")) continue; // a sensitive value left blank is kept
        out[f.id] = raw === undefined || raw === null || raw === "" ? null : f.type === "DATE" ? dayjs(raw as dayjs.Dayjs).format("YYYY-MM-DD") : String(raw);
      }
      return api.setValues(employeeId, out);
    },
    onSuccess: () => { toast.success("Saved."); setEditing(false); setRevealed({}); void queryClient.invalidateQueries({ queryKey: ["custom-fields", "values", employeeId] }); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save.")),
  });
  const reveal = useMutation({ mutationFn: (fieldId: string) => api.revealValue(employeeId, fieldId), onSuccess: (value, fieldId) => setRevealed((r) => ({ ...r, [fieldId]: value })), onError: (e) => toast.error(apiErrorMessage(e, "Could not reveal it.")) });
  const open = () => {
    form.resetFields();
    form.setFieldsValue(Object.fromEntries((q.data ?? []).filter((f) => !f.sensitive).map((f) => [f.id, f.type === "DATE" && f.value ? dayjs(f.value) : f.value ?? undefined])));
    setEditing(true);
  };
  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} isEmpty={(q.data?.length ?? 0) === 0} empty={<EmptyState compact title="No custom fields" description="The directors have not defined any." />}>
      <Panel title="More details" extra={canEdit ? <Button icon={<EditOutlined />} onClick={open}>Edit</Button> : undefined}>
        <KeyValueGrid
          columns={2}
          items={(q.data ?? []).map((f) => ({
            label: f.label,
            value: (
              <span>
                {revealed[f.id] ?? f.value ?? "—"}
                {f.sensitive && f.hasValue && hasRole("SUPER_ADMIN") && !revealed[f.id] && (
                  <Button type="link" size="small" icon={<EyeOutlined />} loading={reveal.isPending && reveal.variables === f.id} onClick={() => reveal.mutate(f.id)} aria-label={`Reveal ${f.label}`}>Reveal</Button>
                )}
              </span>
            ),
          }))}
        />
      </Panel>
      <SideDrawer open={editing} title="Edit more details" subtitle="A sensitive field left empty keeps its value. Changes are audited (the field, never the value)." onClose={() => setEditing(false)} formId="custom-values-form" primaryLabel="Save" primaryLoading={save.isPending}>
        <Form id="custom-values-form" form={form} layout="vertical" requiredMark={false} onFinish={(v) => save.mutate(v)}>
          {(q.data ?? []).map((f) => (
            <Form.Item key={f.id} name={f.id} label={f.sensitive ? `${f.label} (sensitive: type a new value to replace it)` : f.label}>
              {f.type === "CHOICE" ? <Select allowClear options={f.options.map((o) => ({ value: o, label: o }))} /> : f.type === "DATE" ? <DatePicker style={{ width: "100%" }} /> : f.type === "NUMBER" ? <InputNumber style={{ width: "100%" }} /> : <Input maxLength={200} autoComplete="off" />}
            </Form.Item>
          ))}
        </Form>
      </SideDrawer>
    </QueryState>
  );
}
