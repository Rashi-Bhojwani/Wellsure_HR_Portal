import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Form, Input, Select } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import type { LopCorrectionInput, PersonHit } from "../../../api/payroll";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, KeyValueGrid, SideDrawer, Stack, toast } from "../../../ui";
import { Num } from "../../../components/payroll/payrollUi";
import { space } from "../../../theme/tokens";

// Payroll → Adjustments → Correct loss of pay. Attendance was corrected for a month whose payroll run is already final. The run is never changed: the correction is
// previewed here (what each head gives back, and how far back the month is against the rule) and then recorded once, to be paid in the next run.

const RESTORE = [
  { value: "1", label: "Give back a whole day" },
  { value: "0.5", label: "Give back half a day" },
  { value: "-0.5", label: "Take half a day more" },
  { value: "-1", label: "Take a whole day more" },
];

interface Row {
  date: string;
  restored: string | undefined;
}

export function LopCorrectionDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [employeeId, setEmployeeId] = useState<string>();
  const [cycleStart, setCycleStart] = useState("");
  const [ref, setRef] = useState("");
  const [rows, setRows] = useState<Row[]>([{ date: "", restored: undefined }]);
  const [reason, setReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const complete = rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.restored);
  const input: LopCorrectionInput | null =
    employeeId && /^\d{4}-\d{2}-\d{2}$/.test(cycleStart) && ref.trim() && complete && reason.trim().length >= 3
      ? { employeeId, cycleStart, correctionRef: ref.trim(), days: rows.map((r) => ({ date: r.date, restored: r.restored! })), reason: reason.trim(), ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}) }
      : null;
  const preview = useMutation({ mutationFn: () => payrollApi.previewLopCorrection(input!), onSuccess: () => setProblem(null), onError: (e) => setProblem(apiErrorMessage(e, "Could not check that.")) });
  const add = useMutation({
    mutationFn: () => payrollApi.addLopCorrection(input!, preview.data!.fingerprint),
    onSuccess: () => {
      toast.success("Recorded. It is paid in the next run.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not record it.")),
  });
  const p = preview.data;
  const edited = () => preview.reset();
  const patch = (i: number, over: Partial<Row>) => {
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...over } : r)));
    edited();
  };

  return (
    <SideDrawer
      open
      title="Correct loss of pay"
      subtitle={p ? "Check what it does, then record it" : "For a month whose payroll run is already final"}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: space[3], width: "100%" }}>
          <Button size="large" style={{ flex: 1 }} onClick={p ? () => preview.reset() : onClose}>{p ? "Back" : "Cancel"}</Button>
          {p ? (
            <Button size="large" type="primary" style={{ flex: 1 }} loading={add.isPending} onClick={() => add.mutate()}>Record it</Button>
          ) : (
            <Button size="large" type="primary" style={{ flex: 1 }} disabled={!input} loading={preview.isPending} onClick={() => preview.mutate()}>Preview</Button>
          )}
        </div>
      }
    >
      {!p ? (
        <Form layout="vertical" component="div" requiredMark={false}>
          <Form.Item label="Who" htmlFor="lop-employee">
            <Select
              id="lop-employee"
              showSearch
              filterOption={false}
              style={{ width: "100%" }}
              placeholder="Type a name or employee code"
              notFoundContent={null}
              value={employeeId}
              options={hits.map((h) => ({ value: h.employeeId, label: `${h.name} (${h.employeeCode})` }))}
              onSearch={(q) => {
                if (q.trim().length >= 2) void payrollApi.searchPeople(q.trim()).then(setHits);
              }}
              onChange={(v) => { setEmployeeId(v); edited(); }}
            />
          </Form.Item>
          <Form.Item label="First day of the month's payroll period" htmlFor="lop-cycle" extra="For example 2026-08-01">
            <Input id="lop-cycle" inputMode="numeric" maxLength={10} placeholder="YYYY-MM-DD" autoComplete="off" value={cycleStart} onChange={(e) => { setCycleStart(e.target.value); edited(); }} style={{ maxWidth: 220 }} />
          </Form.Item>
          <Form.Item label="Reference of the attendance correction" htmlFor="lop-ref" extra="With the month and the person, this makes sure it is paid once.">
            <Input id="lop-ref" maxLength={60} autoComplete="off" value={ref} onChange={(e) => { setRef(e.target.value); edited(); }} />
          </Form.Item>
          <Form.Item label="Days">
            <Stack gap={space[2]}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center" }}>
                  <Input aria-label={`Date, row ${i + 1}`} style={{ width: 150 }} placeholder="YYYY-MM-DD" maxLength={10} autoComplete="off" value={r.date} onChange={(e) => patch(i, { date: e.target.value })} />
                  <Select aria-label={`What to do, row ${i + 1}`} style={{ flex: 1, minWidth: 180 }} placeholder="Choose" options={RESTORE} value={r.restored} onChange={(v) => patch(i, { restored: v })} />
                  <Button aria-label={`Remove row ${i + 1}`} icon={<DeleteOutlined />} disabled={rows.length === 1} onClick={() => { setRows((rs) => rs.filter((_, k) => k !== i)); edited(); }} />
                </div>
              ))}
              <Button size="small" icon={<PlusOutlined />} onClick={() => { setRows((rs) => [...rs, { date: "", restored: undefined }]); edited(); }}>Add a day</Button>
            </Stack>
          </Form.Item>
          <Form.Item label="Why" htmlFor="lop-reason" validateStatus={problem ? "error" : undefined} help={problem ?? undefined}>
            <Input.TextArea id="lop-reason" rows={3} maxLength={300} showCount value={reason} onChange={(e) => { setReason(e.target.value); edited(); }} />
          </Form.Item>
          <Form.Item label="Reason for going beyond the look-back (only if the preview asks for it)" htmlFor="lop-override">
            <Input.TextArea id="lop-override" rows={2} maxLength={300} value={overrideReason} onChange={(e) => { setOverrideReason(e.target.value); edited(); }} />
          </Form.Item>
        </Form>
      ) : (
        <Stack gap={space[3]}>
          <KeyValueGrid
            columns={1}
            items={[
              { label: "Who", value: p.employeeName },
              { label: "Month", value: p.cycleLabel },
              { label: "How far back", value: `${p.monthsBack} month${p.monthsBack === 1 ? "" : "s"} (the rule allows ${p.lookbackMonths})` },
              { label: "Net", value: <Num strong>{formatRupees(p.net)}</Num> },
            ]}
          />
          {p.needsOverride && <ApprovalBanner tone="warning" title="Beyond the look-back" description={`A director's reason is recorded with it: ${p.overrideReason}`} />}
          <KeyValueGrid columns={1} items={p.lines.map((l) => ({ label: l.component, value: <Num>{formatRupees(l.amount)}</Num> }))} />
          <ApprovalBanner tone="info" title={p.effect} />
          {problem && <ApprovalBanner tone="danger" title={problem} />}
        </Stack>
      )}
    </SideDrawer>
  );
}
