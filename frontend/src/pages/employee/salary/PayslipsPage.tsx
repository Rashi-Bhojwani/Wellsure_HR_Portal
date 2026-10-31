import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Select } from "antd";
import { EyeInvisibleOutlined, EyeOutlined, FilePdfOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import type { PayslipSummary } from "../../../api/payroll";
import { PayslipView } from "../../../components/payroll/PayslipView";
import { PayslipWhyButton } from "../../../components/payroll/PayslipWhy";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { formatRupees } from "../../../lib/money";
import { DataTable, EmptyState, PageHeader, Panel, QueryState, SkeletonCard, SkeletonTable, Stack, toast } from "../../../ui";

// Salary → Payslips (Phase 6 P6-5): the employee's own payslips, newest first, read on screen and downloaded as a PDF. Nobody else's is ever shown here: the server only
// ever answers for the signed-in person. A payslip opens only when the person picks it (the month picker or a row); nothing is opened for them.

export function PayslipsPage() {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Amounts stay masked until the person asks to see them, here as on the Home payslip card (docs/UI_REFERENCE.md §1.1); it is not remembered.
  const [revealed, setRevealed] = useState(false);
  const money = (net: string) => (revealed ? formatRupees(net, 2) : "₹ *****");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["payslips", "mine"], queryFn: payrollApi.myPayslips });
  const slips = data?.payslips ?? [];

  const pdf = async (id: string) => {
    setBusy(true);
    try {
      const link = await payrollApi.myPayslipPdf(id);
      if (link.ready) window.open(link.url, "_blank", "noopener");
      else toast.info(link.message);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not get the PDF."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Payslips"
        subtitle="Your own payslips, newest first"
        actions={
          slips.length > 0 && (
            <>
              <Button icon={revealed ? <EyeInvisibleOutlined /> : <EyeOutlined />} aria-pressed={revealed} onClick={() => setRevealed((r) => !r)}>
                {revealed ? "Hide salary" : "Show salary"}
              </Button>
              <Select
                aria-label="Month"
                placeholder="Choose a month"
                style={{ minWidth: 200 }}
                value={open ?? undefined}
                onChange={(v) => setOpen(v)}
                options={slips.map((s) => ({ value: s.id, label: s.cycleLabel }))}
              />
              <Button type="primary" icon={<FilePdfOutlined />} loading={busy} disabled={!open} onClick={() => open && void pdf(open)}>
                Download PDF
              </Button>
            </>
          )
        }
      />
      <QueryState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        skeleton={<SkeletonTable rows={4} columns={3} />}
        isEmpty={slips.length === 0}
        empty={<EmptyState illustration="documents" title="No payslips yet" description="No payslip has been published for you yet." />}
      >
        <Stack>
          <Panel title="All payslips" subtitle="Choose one to read it here">
            <DataTable<PayslipSummary>
              rowKey="id"
              dataSource={slips}
              pagination={false}
              onRowOpen={(s) => setOpen(s.id)}
              rowClassName={(s) => (s.id === open ? "ant-table-row-selected" : "")}
              mobile={{
                title: (s) => s.cycleLabel,
                subtitle: (s) => `Published ${formatDate(s.publishedAt)}`,
                fields: [{ label: "Net pay", render: (s) => <span className="ws-num">{money(s.net)}</span> }],
                actions: (s) => (
                  <Button block type={s.id === open ? "primary" : "default"} onClick={() => setOpen(s.id)}>
                    Read
                  </Button>
                ),
              }}
              columns={[
                { title: "Month", dataIndex: "cycleLabel", render: (v: string) => <strong>{v}</strong> },
                { title: "Published", key: "pub", render: (_, s) => formatDate(s.publishedAt) },
                { title: "Net pay", key: "net", align: "right", className: "ws-num", render: (_, s) => money(s.net) },
                { title: "", key: "actions", align: "right", render: (_, s) => <Button type="link" onClick={() => setOpen(s.id)}>Read</Button> },
              ]}
            />
          </Panel>
          {open && <One id={open} masked={!revealed} />}
        </Stack>
      </QueryState>
    </>
  );
}

function One({ id, masked }: { id: string; masked: boolean }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["payslips", "mine", id], queryFn: () => payrollApi.myPayslip(id) });
  if (isLoading) return <SkeletonCard lines={8} />;
  if (error || !data) return <EmptyState kind="error" compact title="Could not load this payslip" description={apiErrorMessage(error, "Could not load this payslip.")} />;
  return (
    <>
      <PayslipWhyButton queryKey={["payslips", "mine", id, "why"]} load={() => payrollApi.myPayslipWhy(id)} masked={masked} />
      <PayslipView content={data.content} masked={masked} />
    </>
  );
}
