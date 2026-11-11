import { useState } from "react";
import { Button, Checkbox, DatePicker, Form, Input, Radio, Select, Space } from "antd";
import type { Dayjs } from "dayjs";
import { formatDate, formatDateTime } from "../../lib/dates";
import { ConfirmModal, EmptyState, KeyValueGrid, Panel, QueryState, Stack, StatusChip, Timeline, toast } from "../../ui";
import { human, required, useOptions } from "./helpers";
import { useRecruitmentQuery as useQuery } from "./useRecruitmentQuery";
import { useWork } from "./useWork";
import * as api from "./api";
import * as offersApi from "./offersApi";
import { JoiningSection } from "./JoiningPanel";

// C-4B offer section of the candidate drawer. Non-pay terms for the Wellsure Office and the directors; pay only ever loads for a
// director, on an explicit "Show pay" (each open is audited on the server), and is never cached between openings.

const NEXT: Record<string, Array<{ to: offersApi.OfferState; label: string; director?: boolean; danger?: boolean }>> = {
  DRAFT: [{ to: "PROPOSED", label: "Propose" }, { to: "WITHDRAWN", label: "Withdraw", danger: true }],
  PROPOSED: [{ to: "APPROVED", label: "Approve", director: true }, { to: "ISSUED", label: "Mark issued", director: true }, { to: "WITHDRAWN", label: "Withdraw", danger: true }],
  APPROVED: [{ to: "ISSUED", label: "Mark issued", director: true }, { to: "WITHDRAWN", label: "Withdraw", danger: true }],
  ISSUED: [{ to: "ACCEPTED", label: "Record acceptance" }, { to: "DECLINED", label: "Record decline" }, { to: "EXPIRED", label: "Mark expired" }, { to: "WITHDRAWN", label: "Withdraw", danger: true }],
};
const EMPLOYMENT = ["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT", "PROBATION"].map((value) => ({ value, label: human(value) }));
const money = (v: offersApi.PayValue | null) => (v ? `INR ${v.amount} ${v.period === "ANNUAL" ? "per year" : "per month"}` : "Not recorded");

function PayEditor({ offer }: { offer: offersApi.Offer }) {
  const [shown, setShown] = useState(false);
  const pay = useQuery({ queryKey: ["recruitment", "offer-pay", offer.id], queryFn: () => offersApi.compensation(offer.id), enabled: shown });
  const [form] = Form.useForm();
  const work = useWork(() => { toast.success("Offer pay saved."); form.resetFields(); });
  const editable = offer.state === "DRAFT" || offer.state === "PROPOSED";
  return (
    <Panel title="Offer pay (directors only)" extra={<Button onClick={() => setShown((s) => !s)}>{shown ? "Hide pay" : "Show pay"}</Button>}>
      <p>Pay is recorded {offer.pay?.recorded ? "" : "not yet "}for this offer. Opening it is recorded in the audit log.</p>
      {shown && (
        <QueryState isLoading={pay.isLoading} error={pay.error} onRetry={() => void pay.refetch()}>
          {pay.data && (
            <Stack>
              <KeyValueGrid items={[{ label: "Pay", value: money(pay.data.value) }]} />
              {editable ? (
                <Form form={form} layout="vertical" onFinish={(v: { amount: string; period: "ANNUAL" | "MONTHLY" }) => work.mutate(() => offersApi.saveCompensation(offer.id, { ...v, version: pay.data!.version }))}>
                  <Form.Item name="amount" label="Amount (INR)" rules={[...required, { pattern: /^\d{1,12}(\.\d{1,2})?$/, message: "Enter an amount with at most two decimals." }]}><Input inputMode="decimal" autoComplete="off" /></Form.Item>
                  <Form.Item name="period" label="Period" rules={required}><Radio.Group options={[{ value: "ANNUAL", label: "Per year" }, { value: "MONTHLY", label: "Per month" }]} /></Form.Item>
                  <Button htmlType="submit" loading={work.isPending}>Save pay</Button>
                </Form>
              ) : <p>Pay can change only while the offer is a draft or proposed.</p>}
            </Stack>
          )}
        </QueryState>
      )}
    </Panel>
  );
}

export function ExpectedPayPanel({ candidateId }: { candidateId: string }) {
  const [shown, setShown] = useState(false);
  const pay = useQuery({ queryKey: ["recruitment", "expected-pay", candidateId], queryFn: () => offersApi.expectedPay(candidateId), enabled: shown });
  const [form] = Form.useForm();
  const work = useWork(() => { toast.success("Expected pay saved."); form.resetFields(); });
  return (
    <Panel title="Expected pay (directors only)" extra={<Button onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show expected pay"}</Button>}>
      <p>Only directors can see or record what the candidate expects to be paid. Opening it is recorded in the audit log.</p>
      {shown && (
        <QueryState isLoading={pay.isLoading} error={pay.error} onRetry={() => void pay.refetch()}>
          {pay.data && (
            <Stack>
              <KeyValueGrid items={[{ label: "Expected pay", value: money(pay.data.value) }]} />
              <Form form={form} layout="vertical" onFinish={(v: { amount: string; period: "ANNUAL" | "MONTHLY" }) => work.mutate(() => offersApi.saveExpectedPay(candidateId, v))}>
                <Form.Item name="amount" label="Amount (INR)" rules={[...required, { pattern: /^\d{1,12}(\.\d{1,2})?$/, message: "Enter an amount with at most two decimals." }]}><Input inputMode="decimal" autoComplete="off" /></Form.Item>
                <Form.Item name="period" label="Period" rules={required}><Radio.Group options={[{ value: "ANNUAL", label: "Per year" }, { value: "MONTHLY", label: "Per month" }]} /></Form.Item>
                <Space wrap>
                  <Button htmlType="submit" loading={work.isPending}>Save expected pay</Button>
                  {pay.data.value && <Button danger onClick={() => work.mutate(() => offersApi.saveExpectedPay(candidateId, null))}>Clear</Button>}
                </Space>
              </Form>
            </Stack>
          )}
        </QueryState>
      )}
    </Panel>
  );
}

function OfferCard({ offer }: { offer: offersApi.Offer }) {
  const detail = useQuery({ queryKey: ["recruitment", "offer", offer.id], queryFn: () => offersApi.offer(offer.id) });
  const row = detail.data ?? offer;
  const [pending, setPending] = useState<{ to: offersApi.OfferState; label: string } | null>(null);
  const [form] = Form.useForm();
  const work = useWork(() => { setPending(null); form.resetFields(); toast.success("Offer updated."); });
  const actions = (NEXT[row.state] ?? []).filter((a) => (a.director ? row.isDirector : row.canManage)).filter((a) => (a.to === "APPROVED" ? row.approvalRequired === true : a.to === "ISSUED" && row.state === "PROPOSED" ? row.approvalRequired === false : true));
  return (
    <Panel title={row.title} extra={<StatusChip>{human(row.state)}</StatusChip>}>
      <Stack>
        <KeyValueGrid items={[
          { label: "Job", value: row.job.title },
          { label: "Department", value: row.department?.name ?? "—" },
          { label: "Location", value: row.location?.name ?? "—" },
          { label: "Reporting manager", value: row.reportingManager?.name ?? "Not chosen" },
          { label: "Employment type", value: human(row.employmentType) },
          { label: "Joining date", value: formatDate(row.joiningDate) },
          ...(row.approvalRequired !== null ? [{ label: "Approval", value: row.approvalRequired ? "Director approval required" : "No approval step" }] : []),
        ]} />
        {row.state === "ISSUED" || row.state === "PROPOSED" || row.state === "APPROVED" ? <p>The letter that carries pay is sent by a director through Letters; this screen records the offer's state only.</p> : null}
        {actions.length > 0 && <Space wrap>{actions.map((a) => <Button key={a.to} danger={a.danger} onClick={() => setPending(a)}>{a.label}</Button>)}</Space>}
        {row.isDirector && <PayEditor offer={row} />}
        <Timeline items={(row.events ?? []).map((e) => ({ key: String(e.version), content: <>{e.kind === "COMPENSATION" ? "Pay updated (director)" : e.kind === "CREATED" ? "Offer drafted" : `Moved to ${human(e.toState)}`}</>, time: formatDateTime(e.createdAt), detail: e.reason ?? (e.letterReference ? `Letter ${e.letterReference}` : undefined) }))} empty={<p>No history yet.</p>} />
      </Stack>
      <ConfirmModal open={Boolean(pending)} title={pending ? `${pending.label}?` : ""} confirmLabel={pending?.label ?? "Confirm"} danger={pending?.to === "WITHDRAWN"} loading={work.isPending} onCancel={() => setPending(null)} onConfirm={() => form.submit()}>
          <Form form={form} layout="vertical" onFinish={(v: { reason?: string; letterSentThroughLetters?: boolean; letterReference?: string }) => work.mutate(() => offersApi.moveOffer(row.id, { to: pending!.to, version: row.version, reason: v.reason || undefined, letterReference: v.letterReference || undefined, ...(pending!.to === "ISSUED" ? { letterSentThroughLetters: true as const } : {}) }))}>
            {pending?.to === "ISSUED" && <>
              <Form.Item name="letterSentThroughLetters" valuePropName="checked" rules={[{ validator: (_, value: boolean) => (value ? Promise.resolve() : Promise.reject(new Error("Confirm the letter was sent."))) }]}><Checkbox>I sent the offer letter through Letters.</Checkbox></Form.Item>
              <Form.Item name="letterReference" label="Letter reference (optional)" rules={[{ pattern: /^[A-Za-z0-9/_-]{1,60}$/, message: "Use the letter's reference code only." }]}><Input maxLength={60} /></Form.Item>
            </>}
            <Form.Item name="reason" label={pending?.to === "WITHDRAWN" ? "Reason (no pay figures)" : "Note (optional, no pay figures)"} rules={pending?.to === "WITHDRAWN" ? required : []}><Input.TextArea maxLength={500} rows={2} /></Form.Item>
          </Form>
      </ConfirmModal>
    </Panel>
  );
}

function NewOffer({ candidate, onDone }: { candidate: api.Candidate; onDone: () => void }) {
  const [form] = Form.useForm();
  const options = useOptions();
  const managers = useQuery({ queryKey: ["recruitment", "panel-options", ""], queryFn: () => api.panelOptions("") });
  const work = useWork(() => { form.resetFields(); toast.success("Offer drafted."); onDone(); });
  const active = (candidate.applications ?? []).filter((a) => a.status === "ACTIVE");
  if (!active.length) return <EmptyState title="No active application" description="An offer needs an active application." compact />;
  return (
    <Panel title="Draft an offer">
      <Form form={form} layout="vertical" onFinish={(v: { applicationId: string; title: string; departmentId: string; locationId: string; reportingManagerId?: string; employmentType: string; joiningDate: Dayjs }) => work.mutate(() => offersApi.createOffer({ ...v, reportingManagerId: v.reportingManagerId ?? null, joiningDate: v.joiningDate.format("YYYY-MM-DD") }))}>
        <Form.Item name="applicationId" label="Application" rules={required}><Select placeholder="Choose application" options={active.map((a) => ({ value: a.id, label: a.job?.title ?? "Application" }))} /></Form.Item>
        <Form.Item name="title" label="Role" rules={required}><Input maxLength={150} /></Form.Item>
        <Form.Item name="departmentId" label="Department" rules={required}><Select placeholder="Choose department" options={options.data?.departments.map((d) => ({ value: d.id, label: d.name }))} /></Form.Item>
        <Form.Item name="locationId" label="Location" rules={required}><Select placeholder="Choose location" options={options.data?.locations.map((d) => ({ value: d.id, label: d.name }))} /></Form.Item>
        <Form.Item name="reportingManagerId" label="Reporting manager (optional)"><Select allowClear showSearch optionFilterProp="label" placeholder="Choose manager" options={managers.data?.map((p) => ({ value: p.id, label: `${p.name} (${p.employeeCode})` }))} /></Form.Item>
        <Form.Item name="employmentType" label="Employment type" rules={required}><Select placeholder="Choose type" options={EMPLOYMENT} /></Form.Item>
        <Form.Item name="joiningDate" label="Joining date" rules={required}><DatePicker style={{ width: "100%" }} /></Form.Item>
        <p>Pay is added afterwards by a director.</p>
        <Button type="primary" htmlType="submit" loading={work.isPending}>Draft offer</Button>
      </Form>
    </Panel>
  );
}

export function OfferSection({ candidate, status }: { candidate: api.Candidate; status: offersApi.OfferStatus }) {
  const list = useQuery({ queryKey: ["recruitment", "offers", "candidate", candidate.id], queryFn: () => offersApi.offers({ candidateId: candidate.id }) });
  const [drafting, setDrafting] = useState(false);
  const live = list.data?.items.some((o) => ["DRAFT", "PROPOSED", "APPROVED", "ISSUED", "ACCEPTED"].includes(o.state));
  return (
    <Stack>
      {status.isDirector && !candidate.anonymized && !candidate.expired && <ExpectedPayPanel candidateId={candidate.id} />}
      <QueryState isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
        {list.data && (list.data.items.length ? list.data.items.map((o) => <OfferCard key={o.id} offer={o} />) : <EmptyState title="No offers" description={status.offerManage ? "Draft an offer from an active application." : "No accepted offer yet."} compact />)}
      </QueryState>
      {list.data?.items.some((o) => o.state === "ACCEPTED") && (status.onboarding || status.isApprover) && <JoiningSection candidateId={candidate.id} />}
      {status.offerManage && !live && !candidate.anonymized && !candidate.expired && (drafting ? <NewOffer candidate={candidate} onDone={() => setDrafting(false)} /> : <Button onClick={() => setDrafting(true)}>Draft an offer</Button>)}
    </Stack>
  );
}
