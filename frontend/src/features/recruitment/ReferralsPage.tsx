import { Button, Checkbox, Form, Input, Select } from "antd";
import { formatDateTime } from "../../lib/dates";
import { DataTable, EmptyState, PageHeader, Panel, QueryState, Stack, StatusChip, toast } from "../../ui";
import { RecruitmentBoundary } from "./RecruitmentBoundary";
import { required } from "./helpers";
import { useRecruitmentQuery as useQuery } from "./useRecruitmentQuery";
import { useWork } from "./useWork";
import * as offersApi from "./offersApi";

// C-4B referrals (employee portal). Off unless a director switches referrals on. The referrer sees basic status only.
const LABEL: Record<offersApi.MyReferral["status"], string> = { SUBMITTED: "Submitted", IN_REVIEW: "In review", CLOSED: "Closed" };

function ReferForm() {
  const jobs = useQuery({ queryKey: ["recruitment", "referral-jobs"], queryFn: offersApi.referralJobs });
  const [form] = Form.useForm();
  const work = useWork(() => { form.resetFields(); toast.success("Thank you. Your referral was sent to the recruiting team."); });
  return (
    <Panel title="Refer someone">
      <QueryState isLoading={jobs.isLoading} error={jobs.error} onRetry={() => void jobs.refetch()}>
        {jobs.data && (jobs.data.length === 0 ? <EmptyState title="No open jobs" compact /> : (
          <Form form={form} layout="vertical" onFinish={(v: { jobId: string; name: string; email?: string; phone?: string }) => work.mutate(() => offersApi.refer({ jobId: v.jobId, name: v.name, email: v.email || null, phone: v.phone || null, consentConfirmed: true }))}>
            <Form.Item name="jobId" label="Job" rules={required}><Select placeholder="Choose an open job" options={jobs.data.map((j) => ({ value: j.id, label: j.title }))} /></Form.Item>
            <Form.Item name="name" label="Their name" rules={required}><Input maxLength={300} /></Form.Item>
            <Form.Item name="email" label="Email" rules={[{ type: "email" }]}><Input type="email" maxLength={320} /></Form.Item>
            <Form.Item name="phone" label="Phone, including country code"><Input maxLength={40} /></Form.Item>
            <Form.Item name="consentConfirmed" valuePropName="checked" rules={[{ validator: (_, value: boolean) => (value ? Promise.resolve() : Promise.reject(new Error("Confirm their consent."))) }]}><Checkbox>They agreed to be referred and to be contacted.</Checkbox></Form.Item>
            <Button type="primary" htmlType="submit" loading={work.isPending}>Send referral</Button>
          </Form>
        ))}
      </QueryState>
    </Panel>
  );
}

export function ReferralsPage() {
  const q = useQuery({ queryKey: ["recruitment", "referrals", "mine"], queryFn: offersApi.myReferrals });
  return (
    <RecruitmentBoundary>
      <PageHeader title="Referrals" subtitle="Refer someone for an open job and follow its basic status." />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && (
          <Stack>
            {q.data.enabled ? <ReferForm /> : <EmptyState title="Referrals are switched off" description="A director has not switched referrals on." compact />}
            <Panel title="My referrals">
              <DataTable<offersApi.MyReferral> rowKey="id" dataSource={q.data.items} pagination={false} empty={<EmptyState title="No referrals yet" compact />}
                columns={[{ title: "Job", dataIndex: "jobTitle" }, { title: "Sent", dataIndex: "createdAt", render: (v: string) => formatDateTime(v) }, { title: "Status", dataIndex: "status", render: (v: offersApi.MyReferral["status"]) => <StatusChip>{LABEL[v]}</StatusChip> }]}
                mobile={{ title: (r) => r.jobTitle, subtitle: (r) => formatDateTime(r.createdAt), status: (r) => <StatusChip>{LABEL[r.status]}</StatusChip> }} />
            </Panel>
          </Stack>
        )}
      </QueryState>
    </RecruitmentBoundary>
  );
}
