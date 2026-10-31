import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select } from "antd";
import { listEmployees } from "../../../api/employee";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { fs, fw, v } from "../../../theme/tokens";
import { DataTable, EmptyState, PageHeader, Panel, QueryState, SideDrawer, SkeletonTable, Stack, toast, useDebouncedValue } from "../../../ui";
import * as assetsApi from "../api";
import type { OnboardingAvailable } from "../api";

type Item = OnboardingAvailable["assets"][number];
const FORM_ID = "onboarding-issue-form";

// Employee → Issue an asset to a new joiner (HR, Q-14). HR does not see the register: only assets nobody holds that can be issued, and only to someone
// who counts as a new joiner. Closed until the directors allow HR to issue at onboarding and set who counts as a new joiner.
export function OnboardingIssuePage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["assets", "onboarding"], queryFn: assetsApi.onboardingAvailable, retry: false });
  const [issuing, setIssuing] = useState<Item | null>(null);
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 250);
  const people = useQuery({ queryKey: ["assets", "onboarding", "people", q], queryFn: () => listEmployees({ search: q, page: 1, pageSize: 20 }), enabled: issuing !== null });
  const [form] = Form.useForm<{ employeeId: string; conditionCode: string; note?: string }>();
  const issue = useMutation({
    mutationFn: (values: { employeeId: string; conditionCode: string; note?: string }) => assetsApi.issueAtOnboarding(issuing!.id, values),
    onSuccess: () => {
      setIssuing(null);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ["assets", "onboarding"] });
      toast.success("Issued. The new joiner has been asked to acknowledge it.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't issue the asset.")),
  });
  const closed = error && [403, 409].includes((error as { response?: { status?: number } }).response?.status ?? 0);

  return (
    <>
      <PageHeader title="Issue to a new joiner" subtitle="Hand equipment to someone who has just joined" />
      {closed ? (
        <Panel>
          <EmptyState illustration="inbox" title="Not open" description={apiErrorMessage(error, "The directors have not opened this yet.")} compact />
        </Panel>
      ) : (
        <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonTable rows={4} />}>
          <Stack>
            <Panel title="Available to issue">
              <DataTable<Item>
                rowKey="id"
                dataSource={data?.assets ?? []}
                pagination={false}
                empty={<EmptyState title="Nothing available" description="No free asset can be issued right now." compact illustration={false} />}
                columns={[
                  { title: "Asset", key: "a", render: (_: unknown, a) => <div><div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{a.name}</div><div style={{ color: v.textSecondary, fontSize: fs.sm }}>{a.assetId}</div></div> },
                  { title: "Category", dataIndex: "category" },
                  { title: "", key: "act", align: "right", render: (_: unknown, a) => <Button type="primary" onClick={() => setIssuing(a)}>Issue</Button> },
                ]}
                mobile={{ title: (a) => a.name, subtitle: (a) => `${a.assetId} · ${a.category}`, actions: (a) => <Button type="primary" block onClick={() => setIssuing(a)}>Issue</Button> }}
              />
            </Panel>
          </Stack>
        </QueryState>
      )}
      <SideDrawer open={issuing !== null} onClose={() => setIssuing(null)} title="Issue to a new joiner" subtitle={issuing ? `${issuing.assetId} · ${issuing.name}` : undefined} formId={FORM_ID} primaryLabel="Issue" primaryLoading={issue.isPending}>
        <Form id={FORM_ID} form={form} layout="vertical" requiredMark onFinish={(values) => issue.mutate(values)}>
          <Form.Item name="employeeId" label="New joiner" rules={[{ required: true }]} extra="Only someone who counts as a new joiner under the directors' setting is accepted.">
            <Select
              showSearch={{ filterOption: false, onSearch: setSearch }}
              loading={people.isFetching}
              placeholder="Search by name or employee code"
              options={(people.data?.rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode}) · joined ${formatDate(e.dateOfJoining)}` }))}
            />
          </Form.Item>
          <Form.Item name="conditionCode" label="Condition at hand-over" rules={[{ required: true }]}>
            <Select options={(data?.conditions ?? []).map((c) => ({ value: c.code, label: c.label }))} />
          </Form.Item>
          <Form.Item name="note" label="Note" rules={[{ max: 1000 }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
