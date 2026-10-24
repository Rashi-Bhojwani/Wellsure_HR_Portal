import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Flex, Input, Modal, Progress, Segmented, Space, Spin, Table, Tag, Typography, message } from "antd";
import { Link } from "react-router-dom";
import * as payrollApi from "../../../api/payroll";
import type { AccessReport, SetupArea, SetupItem, SetupSection } from "../../../api/payroll";
import { SetupStatusTag } from "../../../components/payroll/SetupStatusTag";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { fs } from "../../../theme/tokens";

const { Title, Text, Paragraph } = Typography;

// Payroll → Setup Checklist (P6-6, docs/plans/PHASE_6.md §14J). Written for the owners: everything that must be entered before a real payroll run, each as Not set, Placeholder or
// Confirmed, who entered it and who confirmed it, where to go to enter it, and who in the company can see and change the secret ones. It shows where things stand, never a value.

function person(p: { name: string; at: string } | null): string | null {
  if (!p) return null;
  return p.at ? `${p.name} on ${formatDate(p.at)}` : p.name;
}

export function SetupChecklistPage() {
  const { hasPermission } = useAuth();
  const [filter, setFilter] = useState<"ALL" | "ATTENTION" | "DONE">("ATTENTION");
  const { data, isLoading, error } = useQuery({ queryKey: ["payroll", "setup"], queryFn: payrollApi.getSetup });
  const [signing, setSigning] = useState<SetupArea | null>(null);
  const queryClient = useQueryClient();

  if (isLoading) return <Spin />;
  if (error || !data) return <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the checklist.")} />;
  const r = data.readiness;
  const keep = (i: SetupItem) => filter === "ALL" || (filter === "DONE" ? i.status === "CONFIRMED" && !i.problem : i.status !== "CONFIRMED" || Boolean(i.problem));

  return (
    <Flex vertical gap={16}>
      <Title level={3} style={{ margin: 0 }}>
        Setup Checklist
      </Title>
      {data.demo && <Alert type="warning" showIcon title="This is the demo company" description="The people, salaries, bank accounts and bank format here are made up. Everything on this page being green means the demo is complete; it says nothing about any real company." />}
      <Text type="secondary">
        Everything that has to be entered before a real payroll run. Each item is <SetupStatusTag status="NOT_SET" /> until somebody enters it, a <SetupStatusTag status="PLACEHOLDER" /> until a different person confirms it, and{" "}
        <SetupStatusTag status="CONFIRMED" /> after. Nothing on this page shows a figure, a number or a code: it shows where each thing stands and who has done what.
      </Text>
      <Card size="small">
        <Flex gap={24} wrap align="center">
          <Progress type="circle" size={72} percent={r.required ? Math.round((r.confirmed / r.required) * 100) : 0} status={r.ready ? "success" : "active"} />
          <Flex vertical gap={4}>
            <Text strong style={{ fontSize: fs.lg }}>{r.confirmed} of {r.required} required items are confirmed</Text>
            <Text type={r.ready ? "success" : "danger"}>{r.ready ? "Ready for the first real run." : `${r.blockers.length} still stand in the way of the first real run.`}</Text>
            <Link to="/admin/payroll/ready">Open “Ready for first real run”</Link>
          </Flex>
        </Flex>
      </Card>
      <Segmented value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[{ value: "ATTENTION", label: "Needs attention" }, { value: "ALL", label: "Everything" }, { value: "DONE", label: "Confirmed" }]} />
      {data.sections.map((s) => (
        <SectionCard key={s.id} section={s} items={s.items.filter(keep)} onSignoff={(a) => setSigning(a)} canSign={hasPermission("payroll.approve")} />
      ))}
      <AccessCard />
      {signing && <SignoffModal area={signing} onClose={() => setSigning(null)} onDone={() => void queryClient.invalidateQueries({ queryKey: ["payroll"] })} />}
    </Flex>
  );
}

function SectionCard({ section, items, onSignoff, canSign }: { section: SetupSection; items: SetupItem[]; onSignoff: (a: SetupArea) => void; canSign: boolean }) {
  if (items.length === 0) return null;
  return (
    <Card size="small" title={section.title} data-testid={`setup-section-${section.id}`}>
      <Paragraph type="secondary">{section.intro}</Paragraph>
      <Table<SetupItem>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={items}
        scroll={{ x: "max-content" }}
        columns={[
          {
            title: "What",
            render: (_, i) => (
              <div style={{ maxWidth: 360 }}>
                <Text strong>{i.title}</Text> {!i.required && <Tag>Not needed for the first run</Tag>}
                <div><Text type="secondary" style={{ fontSize: fs.sm }}>{i.why}</Text></div>
                {i.category && <div><Text type="secondary" style={{ fontSize: fs.sm }}>{i.category}</Text></div>}
                {!i.required && i.notRequiredReason && <div><Text type="secondary" style={{ fontSize: fs.sm }}>{i.notRequiredReason}</Text></div>}
              </div>
            ),
          },
          { title: "Status", render: (_, i) => <SetupStatusTag status={i.status} /> },
          {
            title: "Where it stands",
            render: (_, i) => (
              <Flex vertical gap={4} style={{ maxWidth: 380 }}>
                <Text>{i.detail}</Text>
                {i.coverage && i.coverage.total > 0 && <Progress percent={Math.round((i.coverage.covered / i.coverage.total) * 100)} size="small" format={() => `${i.coverage!.covered} of ${i.coverage!.total}`} />}
                {i.coverage && i.coverage.missing.length > 0 && <Text type="secondary" style={{ fontSize: fs.sm }}>Still missing: {i.coverage.missing.slice(0, 6).map((m) => m.name).join(", ")}{i.coverage.covered + i.coverage.missing.length < i.coverage.total || i.coverage.missing.length > 6 ? " and others" : ""}</Text>}
                {person(i.enteredBy) && <Text type="secondary" style={{ fontSize: fs.sm }}>Entered by {person(i.enteredBy)}</Text>}
                {person(i.confirmedBy) && <Text type="secondary" style={{ fontSize: fs.sm }}>Confirmed by {person(i.confirmedBy)}</Text>}
                {i.question && <Tag color="volcano">An open question stops this being confirmed</Tag>}
                {i.problem && <Alert type="error" showIcon title={i.problem} />}
                {i.permissionNote && <Text type="secondary" style={{ fontSize: fs.sm }}>{i.permissionNote}</Text>}
              </Flex>
            ),
          },
          {
            title: "",
            align: "right",
            render: (_, i) => (
              <Space wrap>
                <Link to={i.where.path}>{i.where.label}</Link>
                {i.signoffArea && i.coverage && i.coverage.total > 0 && i.coverage.covered === i.coverage.total && i.status !== "CONFIRMED" && canSign && (
                  <Button size="small" type="primary" onClick={() => onSignoff(i.signoffArea!)}>
                    Check and sign off…
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}

function SignoffModal({ area, onClose, onDone }: { area: SetupArea; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const { data, isLoading, error } = useQuery({ queryKey: ["payroll", "signoff", area], queryFn: () => payrollApi.previewSignoff(area), refetchOnWindowFocus: false });
  const give = useMutation({
    mutationFn: () => payrollApi.giveSignoff(area, { fingerprint: data!.fingerprint, note }),
    onSuccess: () => {
      void message.success("Signed off. If anything in this set changes later, it will need checking again.");
      onDone();
      onClose();
    },
    onError: (e) => void message.error(apiErrorMessage(e, "Could not sign off.")),
  });
  return (
    <Modal open title={`Check and sign off: ${data?.label ?? ""}`} onCancel={onClose} destroyOnHidden footer={<Space><Button onClick={onClose}>Cancel</Button><Button type="primary" disabled={!data || Boolean(data.blocked) || note.trim().length < 5} loading={give.isPending} onClick={() => give.mutate()}>Sign off</Button></Space>}>
      {isLoading && <Spin />}
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load this.")} />}
      {data && (
        <Flex vertical gap={12}>
          <Text>
            You are saying that you checked <Text strong>all {data.total}</Text> people&rsquo;s {data.label} against the company&rsquo;s own papers. The set is fixed as it is now: if any of it changes afterwards, this sign-off no longer covers it.
          </Text>
          {data.enteredBy.length > 0 && <Text type="secondary">Entered by: {data.enteredBy.join(", ")}. They cannot sign this off.</Text>}
          {data.blocked && <Alert type="warning" showIcon title={data.blocked} />}
          <Input.TextArea rows={2} placeholder="What you checked it against (for example the signed salary letters of 1 October)" value={note} onChange={(e) => setNote(e.target.value)} />
        </Flex>
      )}
    </Modal>
  );
}

function AccessCard() {
  const { data, isLoading, error } = useQuery<AccessReport>({ queryKey: ["payroll", "setup-access"], queryFn: payrollApi.getAccessReport });
  if (isLoading) return <Spin />;
  if (error || !data) return null;
  const names = (rows: Array<{ userId: string; name: string; isDeveloper: boolean; via: string[] }>) =>
    rows.length === 0 ? <Text type="secondary">Nobody</Text> : <Space size={[4, 4]} wrap>{rows.map((h) => <Tag key={h.userId} color={h.isDeveloper ? "red" : undefined}>{h.name}</Tag>)}</Space>;
  return (
    <Card size="small" title="Who can see and change this" data-testid="access-card">
      <Paragraph type="secondary">For each kind of secret, the people who can see it, change it and confirm it right now. If the person who built the system ever appears in a line below, their tag turns red and something is wrong.</Paragraph>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={data.classes}
        scroll={{ x: "max-content" }}
        columns={[
          { title: "What", render: (_, c) => <div style={{ maxWidth: 280 }}><Text strong>{c.label}</Text><div><Text type="secondary" style={{ fontSize: fs.sm }}>{c.what}</Text></div></div> },
          { title: "Can see it", render: (_, c) => names(c.view) },
          { title: "Can change it", render: (_, c) => names(c.edit) },
          { title: "Can confirm it", render: (_, c) => names(c.confirm) },
        ]}
      />
      <Title level={5} style={{ marginTop: 16 }}>Developer accounts</Title>
      {data.developers.length === 0 ? <Text type="secondary">There is no developer account on this system.</Text> : (
        <Flex vertical gap={4}>
          {data.developers.map((d) => <Text key={d.userId}>{d.name} ({d.employeeCode}): {d.holdsAnySecret || d.isSuperAdmin ? <Text type="danger">can reach the owners&rsquo; secrets. This must be fixed.</Text> : <Text type="success">cannot see or change any of the above.</Text>}</Text>)}
        </Flex>
      )}
    </Card>
  );
}
