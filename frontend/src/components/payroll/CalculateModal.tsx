import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Descriptions, Modal, Space, Table, Typography } from "antd";
import { SkeletonCard, toast } from "../../ui";
import * as payrollApi from "../../api/payroll";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDifference, formatRupees } from "../../lib/money";
import { PlaceholderBanner } from "./PlaceholderBanner";

const { Text } = Typography;

/**
 * Calculate or recalculate a run. The preview works everything out in memory and shows who would change and by how much against what the run holds now; confirming
 * sends back the fingerprint of exactly what was shown, and is refused if anything moved in the meantime.
 */
export function CalculateModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const preview = useQuery({ queryKey: ["payroll", "calc-preview", runId], queryFn: () => payrollApi.previewCalculation(runId), retry: false, gcTime: 0, staleTime: 0 });
  const confirm = useMutation({
    mutationFn: () => payrollApi.requestCalculation(runId, preview.data!.fingerprint),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["payroll"] });
      toast.success("Calculating. The figures appear as each group of people is done.");
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "That did not work.")),
  });
  const p = preview.data;
  return (
    <Modal open width={820} title={p?.first ? "Calculate this run" : "Calculate this run again"} onCancel={onClose} okText="Calculate now" okButtonProps={{ disabled: !p, loading: confirm.isPending }} onOk={() => confirm.mutate()} destroyOnHidden>
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        {preview.isLoading && <SkeletonCard lines={4} />}
        {preview.error && <Alert type="error" showIcon title="It cannot be calculated yet" description={apiErrorMessage(preview.error, "Could not work out what this would do.")} />}
        {p && (
          <>
            <PlaceholderBanner watermark={p.watermark} />
            <Descriptions
              size="small"
              bordered
              column={2}
              items={[
                { key: "p", label: "People", children: `${p.people}: ${p.totals.payable} payable, ${p.totals.held} held, ${p.totals.excluded} left out` },
                { key: "e", label: "Need resolving before a submit", children: `${p.totals.exceptions}` },
                { key: "g", label: "Gross", children: p.before ? `${formatRupees(p.before.gross)} now, ${formatRupees(p.totals.gross)} after` : formatRupees(p.totals.gross) },
                { key: "n", label: "Net", children: p.before ? `${formatRupees(p.before.net)} now, ${formatRupees(p.totals.net)} after` : formatRupees(p.totals.net) },
              ]}
            />
            {p.first ? (
              <Alert type="info" showIcon title="This is the first calculation of this run" description="Nothing is calculated until you confirm. Anyone left out is listed on the run with the reason." />
            ) : p.changedCount + p.removedCount === 0 ? (
              <Alert type="success" showIcon title="Nothing would change" description="Everyone would come out exactly as they are now." />
            ) : (
              <Alert type="warning" showIcon title={`${p.changedCount} ${p.changedCount === 1 ? "person changes" : "people change"}${p.removedCount ? `, ${p.removedCount} leave the run` : ""}; ${p.unchanged} stay exactly as they are`} />
            )}
            {p.changes.length > 0 && !p.first && (
              <Table
                size="small"
                pagination={false}
                rowKey="employeeId"
                dataSource={p.changes}
                scroll={{ y: 260 }}
                columns={[
                  { title: "Who", dataIndex: "name" },
                  { title: "Net now", align: "right", className: "ws-num", render: (_, c) => (c.netBefore === null ? <Text type="secondary">new to the run</Text> : formatRupees(c.netBefore, 2)) },
                  { title: "Net after", align: "right", className: "ws-num", render: (_, c) => formatRupees(c.netAfter, 2) },
                  { title: "Change", align: "right", className: "ws-num", render: (_, c) => (c.netBefore === null ? "" : formatDifference(c.netChange ?? "0")) },
                ]}
              />
            )}
            {p.runNotices.map((n) => <Alert key={n} type="info" showIcon title={n} />)}
            {problem && <Alert type="error" showIcon title={problem} />}
          </>
        )}
      </Space>
    </Modal>
  );
}
