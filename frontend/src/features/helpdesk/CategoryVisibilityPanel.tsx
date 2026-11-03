import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Form, Input, Select } from "antd";
import { useAuth } from "../../hooks/useAuth";
import * as api from "../../api/helpdesk";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";
import { ApprovalBanner, EmptyState, Panel, QueryState, SideDrawer, Stack, Timeline, toast } from "../../ui";

export function CategoryVisibilityPanel({ category, onClose }: { category: api.HelpdeskCategory; onClose: () => void }) {
  const { hasPermission, hasRole } = useAuth();
  const allowed = hasPermission("helpdesk.visibility.manage") && hasRole("SUPER_ADMIN") && !hasRole("DEVELOPER");
  const client = useQueryClient();
  const [form] = Form.useForm<{ hrRoleCodes: string[]; employeeIds: string[]; reason: string }>();
  const query = useQuery({ queryKey: ["helpdesk", "visibility", category.id], queryFn: () => api.readVisibility(category.id), enabled: allowed, retry: false });
  useEffect(() => {
    if (query.data) form.setFieldsValue({ hrRoleCodes: query.data.hrRoleCodes, employeeIds: query.data.employeeIds, reason: "" });
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (values: { hrRoleCodes: string[]; employeeIds: string[]; reason: string }) => api.setVisibility(category.id, { ...values, version: query.data!.version }),
    onSuccess: (data) => {
      client.setQueryData(["helpdesk", "visibility", category.id], data);
      void client.invalidateQueries({ queryKey: ["helpdesk"] });
      toast.success("Category visibility saved.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't save visibility. Reload if someone else changed it.")),
  });
  return <SideDrawer open onClose={onClose} title="Who can see this" subtitle={category.name} formId={allowed ? "helpdesk-visibility-form" : undefined} primaryLabel="Save visibility" primaryLoading={save.isPending} primaryDisabled={!query.data || !!query.error}>
    {!allowed ? <EmptyState kind="forbidden" /> : <QueryState isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {query.data && <Stack>
        <div data-testid="helpdesk-category-visibility">
          <ApprovalBanner tone={query.data.state === "NOT_SET" ? "warning" : "info"} title={query.data.state === "NOT_SET" ? "Not set" : query.data.state === "LEGACY" ? "Existing access rules" : "Visibility configured"}
            description={query.data.state === "NOT_SET" ? "Employees cannot raise tickets here until a director chooses the audience." : query.data.state === "LEGACY" ? "Existing helpdesk permissions apply until a director sets an audience." : "Only the chosen handlers and the directors can work these tickets. The employee keeps their own thread."} />
        </div>
        <Form id="helpdesk-visibility-form" form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="hrRoleCodes" label="HR roles" extra="Chosen roles still need the helpdesk permission, and the sensitive-ticket permission where required.">
            <Select mode="multiple" allowClear options={[{ value: "HR_ADMIN", label: "HR Admin" }, { value: "HR_EXECUTIVE", label: "HR Executive" }]} />
          </Form.Item>
          <Form.Item name="employeeIds" label="Named people" extra="For a directors-only audience, choose the directors here and leave HR roles empty.">
            <Select mode="multiple" allowClear showSearch={{ optionFilterProp: "label" }} options={query.data.people.map((p) => ({ value: p.id, label: `${p.name ?? p.employeeCode} (${p.employeeCode})${p.director ? " · Director" : ""}` }))} />
          </Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true, whitespace: true, message: "Enter a reason." }]} extra="Recorded in the immutable visibility history.">
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
        <Panel title="Visibility history">
          {query.data.history.length ? <Timeline items={query.data.history.map((h) => ({ key: h.id, time: formatDateTime(h.changedAt), content: <span>Version {h.version} · {h.reason}</span> }))} /> : <EmptyState compact title="No visibility decisions yet" description="The first saved decision will appear here." />}
        </Panel>
      </Stack>}
    </QueryState>}
  </SideDrawer>;
}
