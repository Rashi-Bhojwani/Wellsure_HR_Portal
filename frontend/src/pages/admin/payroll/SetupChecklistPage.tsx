import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Flex, Input, Modal, Segmented, Space, Typography } from "antd";
import { Link } from "react-router-dom";
import * as payrollApi from "../../../api/payroll";
import type { AccessReport, SetupArea, SetupItem, SetupSection } from "../../../api/payroll";
import { SetupStatusTag } from "../../../components/payroll/SetupStatusTag";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { fs, fw, v } from "../../../theme/tokens";
import { DataTable, EmptyState, PageHeader, Panel, SkeletonCard, Stack, StatusChip, toast } from "../../../ui";
import { AccordionItem } from "../../../components/payroll/AccordionItem";
import { ProgressRow } from "../../../components/payroll/payrollUi";

const { Text } = Typography;

// Payroll → Setup Checklist (P6-6, docs/plans/PHASE_6.md §14J). Written for the owners: everything that must be entered before a real payroll run, each as Not set, Placeholder or
// Confirmed, who entered it and who confirmed it, where to go to enter it, and who in the company can see and change the secret ones. It shows where things stand, never a value.

function person(p: { name: string; at: string } | null): string | null {
  if (!p) return null;
  return p.at ? `${p.name} on ${formatDate(p.at)}` : p.name;
}

export function SetupChecklistPage() {
  const { hasPermission } = useAuth();
  const [filter, setFilter] = useState<"ALL" | "ATTENTION" | "DONE">("ATTENTION");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["payroll", "setup"], queryFn: payrollApi.getSetup });
  const [signing, setSigning] = useState<SetupArea | null>(null);
  const queryClient = useQueryClient();

  const header = <PageHeader title="Setup Checklist" subtitle="Everything that has to be entered before a real payroll run" actions={<Link to="/admin/payroll/ready"><Button>Open “Ready for first real run”</Button></Link>} />;
  if (isLoading)
    return (
      <>
        {header}
        <Stack>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={6} />
        </Stack>
      </>
    );
  if (error || !data)
    return (
      <>
        {header}
        <EmptyState kind="error" title="Could not load the checklist" description={apiErrorMessage(error, "Could not load the checklist.")} onRetry={() => void refetch()} />
      </>
    );
  const r = data.readiness;
  const keep = (i: SetupItem) => filter === "ALL" || (filter === "DONE" ? i.status === "CONFIRMED" && !i.problem : i.status !== "CONFIRMED" || Boolean(i.problem));

  return (
    <>
      {header}
      <Stack>
        {data.demo && <Alert type="warning" showIcon title="This is the demo company" description="The people, salaries, bank accounts and bank format here are made up. Everything on this page being green means the demo is complete; it says nothing about any real company." />}
        <Panel>
          <Flex vertical gap={12}>
            <Flex justify="space-between" align="center" gap={12} wrap>
              <div>
                <div style={{ fontSize: fs.xl, fontWeight: fw.bold, color: v.textPrimary }}>
                  {r.confirmed} of {r.required} required items are confirmed
                </div>
                <Text type={r.ready ? "success" : "danger"}>{r.ready ? "Ready for the first real run." : `${r.blockers.length} still stand in the way of the first real run.`}</Text>
              </div>
              <ProgressRow done={r.confirmed} total={r.required} label="confirmed" width={180} />
            </Flex>
            <Text type="secondary">
              Each item is <SetupStatusTag status="NOT_SET" /> until somebody enters it, a <SetupStatusTag status="PLACEHOLDER" /> until a director confirms it, and <SetupStatusTag status="CONFIRMED" /> after. Nothing on this page shows a figure, a number or a code: it shows where each thing stands and who has done what.
            </Text>
          </Flex>
        </Panel>
        <Segmented value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[{ value: "ATTENTION", label: "Needs attention" }, { value: "ALL", label: "Everything" }, { value: "DONE", label: "Confirmed" }]} style={{ alignSelf: "flex-start" }} />
        {data.sections.map((s) => (
          <SectionCard key={s.id} section={s} items={s.items.filter(keep)} onSignoff={(a) => setSigning(a)} canSign={hasPermission("payroll.approve")} />
        ))}
        <AccessCard />
      </Stack>
      {signing && <SignoffModal area={signing} onClose={() => setSigning(null)} onDone={() => void queryClient.invalidateQueries({ queryKey: ["payroll"] })} />}
    </>
  );
}

function SectionCard({ section, items, onSignoff, canSign }: { section: SetupSection; items: SetupItem[]; onSignoff: (a: SetupArea) => void; canSign: boolean }) {
  if (items.length === 0) return null;
  const done = section.items.filter((i) => i.status === "CONFIRMED" && !i.problem).length;
  return (
    <div data-testid={`setup-section-${section.id}`}>
      <Panel title={section.title} subtitle={section.intro} extra={<ProgressRow done={done} total={section.items.length} label="confirmed" />}>
        <Flex vertical gap={12}>
          {items.map((i) => (
            <AccordionItem
              key={i.id}
              defaultOpen={Boolean(i.problem)}
              title={i.title}
              chips={
                <>
                  <SetupStatusTag status={i.status} />
                  {!i.required && <StatusChip tone="neutral">Not needed for the first run</StatusChip>}
                  {i.question && <StatusChip tone="danger">An open question stops this being confirmed</StatusChip>}
                </>
              }
              summary={
                <>
                  {i.detail}
                  {i.coverage && i.coverage.total > 0 && (
                    <span style={{ display: "block", marginTop: 6 }}>
                      <ProgressRow done={i.coverage.covered} total={i.coverage.total} label="on record" />
                    </span>
                  )}
                </>
              }
              right={
                <>
                  <Link to={i.where.path}>{i.where.label}</Link>
                  {i.signoffArea && i.coverage && i.coverage.total > 0 && i.coverage.covered === i.coverage.total && i.status !== "CONFIRMED" && canSign && (
                    <Button size="small" type="primary" onClick={() => onSignoff(i.signoffArea!)}>
                      Check and sign off…
                    </Button>
                  )}
                </>
              }
            >
              <Flex vertical gap={6}>
                <Text>{i.why}</Text>
                {i.category && <Text type="secondary" style={{ fontSize: fs.sm }}>{i.category}</Text>}
                {!i.required && i.notRequiredReason && <Text type="secondary" style={{ fontSize: fs.sm }}>{i.notRequiredReason}</Text>}
                {i.coverage && i.coverage.missing.length > 0 && <Text type="secondary" style={{ fontSize: fs.sm }}>Still missing: {i.coverage.missing.slice(0, 6).map((m) => m.name).join(", ")}{i.coverage.covered + i.coverage.missing.length < i.coverage.total || i.coverage.missing.length > 6 ? " and others" : ""}</Text>}
                {person(i.enteredBy) && <Text type="secondary" style={{ fontSize: fs.sm }}>Entered by {person(i.enteredBy)}</Text>}
                {person(i.confirmedBy) && <Text type="secondary" style={{ fontSize: fs.sm }}>Confirmed by {person(i.confirmedBy)}</Text>}
                {!person(i.enteredBy) && !person(i.confirmedBy) && <Text type="secondary" style={{ fontSize: fs.sm }}>Nobody has entered or confirmed this yet.</Text>}
                {i.problem && <Alert type="error" showIcon title={i.problem} />}
                {i.permissionNote && <Text type="secondary" style={{ fontSize: fs.sm }}>{i.permissionNote}</Text>}
              </Flex>
            </AccordionItem>
          ))}
        </Flex>
      </Panel>
    </div>
  );
}

function SignoffModal({ area, onClose, onDone }: { area: SetupArea; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const { data, isLoading, error } = useQuery({ queryKey: ["payroll", "signoff", area], queryFn: () => payrollApi.previewSignoff(area), refetchOnWindowFocus: false });
  const give = useMutation({
    mutationFn: () => payrollApi.giveSignoff(area, { fingerprint: data!.fingerprint, note }),
    onSuccess: () => {
      toast.success("Signed off. If anything in this set changes later, it will need checking again.");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not sign off.")),
  });
  return (
    <Modal open title={`Check and sign off: ${data?.label ?? ""}`} onCancel={onClose} destroyOnHidden footer={<Space><Button onClick={onClose}>Cancel</Button><Button type="primary" disabled={!data || Boolean(data.blocked) || note.trim().length < 5} loading={give.isPending} onClick={() => give.mutate()}>Sign off</Button></Space>}>
      {isLoading && <SkeletonCard lines={3} />}
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load this.")} />}
      {data && (
        <Flex vertical gap={12}>
          <Text>
            You are saying that you checked <Text strong>all {data.total}</Text> people&rsquo;s {data.label} against the company&rsquo;s own papers. The set is fixed as it is now: if any of it changes afterwards, this sign-off no longer covers it.
          </Text>
          {data.enteredBy.length > 0 && <Text type="secondary">Entered by: {data.enteredBy.join(", ")}. They cannot sign this off.</Text>}
          {data.blocked && <Alert type="warning" showIcon title={data.blocked} />}
          <Input.TextArea rows={2} aria-label="What you checked it against" placeholder="What you checked it against (for example the signed salary letters of 1 October)" value={note} onChange={(e) => setNote(e.target.value)} />
        </Flex>
      )}
    </Modal>
  );
}

function AccessCard() {
  const { data, isLoading, error } = useQuery<AccessReport>({ queryKey: ["payroll", "setup-access"], queryFn: payrollApi.getAccessReport });
  if (isLoading) return <SkeletonCard lines={5} />;
  if (error || !data) return null;
  const names = (rows: Array<{ userId: string; name: string; isDeveloper: boolean; via: string[] }>) =>
    rows.length === 0 ? <Text type="secondary">Nobody</Text> : <Space size={[4, 4]} wrap>{rows.map((h) => (h.isDeveloper ? <StatusChip key={h.userId} tone="danger">{h.name} (developer)</StatusChip> : <StatusChip key={h.userId} tone="neutral">{h.name}</StatusChip>))}</Space>;
  type Row = AccessReport["classes"][number];
  return (
    <div data-testid="access-card">
      <Panel title="Who can see and change this" subtitle="For each kind of secret, the people who can see it, change it and confirm it right now. If the person who built the system ever appears in a line below, their tag turns red and something is wrong.">
        <DataTable<Row>
          density="compact"
          rowKey="id"
          pagination={false}
          dataSource={data.classes}
          mobile={{
            title: (c) => c.label,
            subtitle: (c) => c.what,
            fields: [
              { label: "Can see it", render: (c) => names(c.view) },
              { label: "Can change it", render: (c) => names(c.edit) },
              { label: "Can confirm it", render: (c) => names(c.confirm) },
            ],
          }}
          columns={[
            { title: "What", key: "what", render: (_, c) => <div style={{ maxWidth: 280 }}><Text strong>{c.label}</Text><div><Text type="secondary" style={{ fontSize: fs.sm }}>{c.what}</Text></div></div> },
            { title: "Can see it", key: "view", render: (_, c) => names(c.view) },
            { title: "Can change it", key: "edit", render: (_, c) => names(c.edit) },
            { title: "Can confirm it", key: "confirm", render: (_, c) => names(c.confirm) },
          ]}
        />
        <h3 style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary, margin: "16px 0 8px" }}>Developer accounts</h3>
        {data.developers.length === 0 ? <Text type="secondary">There is no developer account on this system.</Text> : (
          <Flex vertical gap={4}>
            {data.developers.map((d) => <Text key={d.userId}>{d.name} ({d.employeeCode}): {d.holdsAnySecret || d.isSuperAdmin ? <Text type="danger">can reach the owners&rsquo; secrets. This must be fixed.</Text> : <Text type="success">cannot see or change any of the above.</Text>}</Text>)}
          </Flex>
        )}
      </Panel>
    </div>
  );
}
