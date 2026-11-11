import { useState } from "react";
import { Button, Select, Space, Tabs } from "antd";
import { formatDate, formatDateTime } from "../../lib/dates";
import { ConfirmModal, DataTable, EmptyState, PageHeader, QueryState, SideDrawer, Stack, StatusChip, toast } from "../../ui";
import { RecruitmentBoundary } from "./RecruitmentBoundary";
import { human, useOptions } from "./helpers";
import { useRecruitmentQuery as useQuery } from "./useRecruitmentQuery";
import { useWork } from "./useWork";
import { OfferSection } from "./OfferPanel";
import { JoiningSection } from "./JoiningPanel";
import * as api from "./api";
import * as offersApi from "./offersApi";

// C-4B "Offers and joining" (admin portal). The Wellsure Office and the directors see every offer's non-pay terms; HR onboarding
// sees accepted offers only, to run joining checks and conversion. No pay appears in this list for anyone.

const STATES: offersApi.OfferState[] = ["DRAFT", "PROPOSED", "APPROVED", "ISSUED", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"];

function OfferDrawer({ offer, status, onClose }: { offer: offersApi.Offer; status: offersApi.OfferStatus; onClose: () => void }) {
  const candidate = useQuery({ queryKey: ["recruitment", "candidate", offer.candidate.id], queryFn: () => api.candidate(offer.candidate.id), enabled: status.offerManage });
  return (
    <SideDrawer open title={offer.candidate.name} size="xwide" onClose={onClose} footer={null}>
      <Tabs items={[
        ...(status.offerManage ? [{ key: "offer", label: "Offer", children: <QueryState isLoading={candidate.isLoading} error={candidate.error} onRetry={() => void candidate.refetch()}>{candidate.data && <OfferSection candidate={candidate.data} status={status} />}</QueryState> }] : []),
        ...(offer.state === "ACCEPTED" && !status.offerManage && (status.onboarding || status.isApprover) ? [{ key: "joining", label: "Joining", children: <JoiningSection candidateId={offer.candidate.id} /> }] : []),
      ]} />
    </SideDrawer>
  );
}

function OffersTab({ status }: { status: offersApi.OfferStatus }) {
  const [state, setState] = useState<offersApi.OfferState | undefined>(status.offerManage ? undefined : "ACCEPTED");
  const [open, setOpen] = useState<offersApi.Offer | null>(null);
  const q = useQuery({ queryKey: ["recruitment", "offers", state ?? "all"], queryFn: () => offersApi.offers(state ? { state } : {}) });
  return (
    <Stack>
      {status.offerManage && <Select allowClear placeholder="All states" style={{ minWidth: 200 }} value={state} onChange={(v) => setState(v)} options={STATES.map((s) => ({ value: s, label: human(s) }))} aria-label="Filter by state" />}
      <DataTable<offersApi.Offer> rowKey="id" dataSource={q.data?.items ?? []} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} onRowOpen={(r) => setOpen(r)}
        empty={<EmptyState title="No offers" description={status.offerManage ? "Offers are drafted from a candidate's active application." : "Accepted offers appear here for joining."} compact />}
        columns={[
          { title: "Candidate", key: "c", render: (_: unknown, r: offersApi.Offer) => r.candidate.name },
          { title: "Role", dataIndex: "title" },
          { title: "Joining date", dataIndex: "joiningDate", render: (v: string) => formatDate(v) },
          { title: "State", dataIndex: "state", render: (v: string) => <StatusChip>{human(v)}</StatusChip> },
          { title: "", key: "open", render: (_: unknown, r: offersApi.Offer) => <Button onClick={(e) => { e.stopPropagation(); setOpen(r); }}>Open</Button> },
        ]}
        mobile={{ title: (r) => r.candidate.name, subtitle: (r) => r.title, status: (r) => <StatusChip>{human(r.state)}</StatusChip>, fields: [{ label: "Joining", render: (r) => formatDate(r.joiningDate) }], actions: (r) => <Button onClick={() => setOpen(r)}>Open</Button> }} />
      {open && <OfferDrawer offer={open} status={status} onClose={() => setOpen(null)} />}
    </Stack>
  );
}

function ReferralsTab() {
  const q = useQuery({ queryKey: ["recruitment", "referrals", "review"], queryFn: offersApi.referrals });
  const options = useOptions();
  const [source, setSource] = useState<string>();
  const [closing, setClosing] = useState<string | null>(null);
  const work = useWork(() => { setClosing(null); toast.success("Referral updated."); });
  return (
    <Stack>
      <Select placeholder="Source for accepted referrals" style={{ minWidth: 240 }} value={source} onChange={setSource} options={options.data?.sources?.map((s) => ({ value: s.code, label: s.label }))} aria-label="Candidate source" />
      <DataTable<offersApi.Referral> rowKey="id" dataSource={q.data?.items ?? []} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}
        empty={<EmptyState title="No referrals waiting" compact />}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Job", key: "j", render: (_: unknown, r: offersApi.Referral) => r.job.title },
          { title: "Received", dataIndex: "createdAt", render: (v: string) => formatDateTime(v) },
          { title: "", key: "a", render: (_: unknown, r: offersApi.Referral) => <Space wrap><Button disabled={!source} onClick={() => work.mutate(() => offersApi.acceptReferral(r.id, source!))}>Accept</Button><Button danger onClick={() => setClosing(r.id)}>Close</Button></Space> },
        ]}
        mobile={{ title: (r) => r.name, subtitle: (r) => r.job.title, actions: (r) => <Space wrap><Button disabled={!source} onClick={() => work.mutate(() => offersApi.acceptReferral(r.id, source!))}>Accept</Button><Button danger onClick={() => setClosing(r.id)}>Close</Button></Space> }} />
      <ConfirmModal open={Boolean(closing)} title="Close this referral?" description="The referred person's details are removed; the referrer sees Closed." confirmLabel="Close referral" danger loading={work.isPending} onCancel={() => setClosing(null)} onConfirm={() => work.mutate(() => offersApi.closeReferral(closing!))} />
    </Stack>
  );
}

export function OffersPage() {
  const status = useQuery({ queryKey: ["recruitment", "offer-status"], queryFn: offersApi.offerStatus });
  const referral = useQuery({ queryKey: ["recruitment", "referral-status"], queryFn: offersApi.referralStatus });
  const allowed = status.data && (status.data.offerManage || status.data.onboarding || status.data.isApprover);
  return (
    <RecruitmentBoundary>
      <PageHeader title="Offers and joining" subtitle="Offer states, joining documents and conversion. Pay is shown to directors only." />
      <QueryState isLoading={status.isLoading} error={status.error} onRetry={() => void status.refetch()}>
        {status.data && (allowed ? (
          <Tabs items={[
            { key: "offers", label: "Offers", children: <OffersTab status={status.data} /> },
            ...(referral.data?.enabled && referral.data.canReview ? [{ key: "referrals", label: "Referrals", children: <ReferralsTab /> }] : []),
          ]} />
        ) : <EmptyState kind="forbidden" title="No access" description="Offers are for the Wellsure Office and the directors; joining is for HR onboarding." />)}
      </QueryState>
    </RecruitmentBoundary>
  );
}
