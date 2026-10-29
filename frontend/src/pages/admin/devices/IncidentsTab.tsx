import { useQuery } from "@tanstack/react-query";
import { Tooltip } from "antd";
import * as biometricApi from "../../../api/biometric";
import type { IncidentRow } from "../../../api/biometric";
import { fs, space, v } from "../../../theme/tokens";
import { DataTable, EmptyState, StatusChip } from "../../../ui";
import { KIND_LABEL, when } from "./deviceLabels";

const recoveryText = (i: IncidentRow) =>
  i.recovery?.arrivedPunches != null
    ? `${i.recovery.arrivedPunches} punch${i.recovery.arrivedPunches === 1 ? "" : "es"} arrived afterwards${i.recovery.expectedWithoutPunch ? `; ${i.recovery.expectedWithoutPunch} still without one` : ""}`
    : i.isOpen
      ? ""
      : "—";

const StateChip = ({ i }: { i: IncidentRow }) => (i.isOpen ? <StatusChip tone="danger">Open</StatusChip> : <StatusChip tone="success">Closed</StatusChip>);

const Repeated = ({ i }: { i: IncidentRow }) =>
  i.escalatedAt ? (
    <Tooltip title={`Told again at the start of the next working day (${when(i.escalatedAt)})`}>
      <span tabIndex={0}>
        <StatusChip tone="neutral">repeated</StatusChip>
      </span>
    </Tooltip>
  ) : null;

export function IncidentsTab() {
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["biometric", "incidents"], queryFn: () => biometricApi.listIncidents({ state: "all", limit: 100 }) });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
      <p style={{ margin: 0, color: v.textSecondary, fontSize: fs.md }}>
        Each stretch of trouble with a device or a sync agent: when it started, how long it lasted, and what was missed. Open ones are first. HR is told once when one opens, once more if it is still open at the start
        of the next working day, and once when it closes.
      </p>
      <DataTable<IncidentRow>
        rowKey="id"
        density="compact"
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        dataSource={data}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        empty={<EmptyState compact title="No incidents. Nothing has gone quiet." description={null} />}
        expandable={{ expandedRowRender: (i) => <p style={{ margin: 0, color: v.textBody }}>{i.detail}</p> }}
        columns={[
          { title: "State", key: "state", render: (_, i) => <StateChip i={i} /> },
          { title: "What", key: "kind", render: (_, i) => KIND_LABEL[i.kind] },
          {
            title: "Device / agent",
            key: "subject",
            render: (_, i) => (
              <>
                {i.subject}
                {i.branch ? <span style={{ color: v.textSecondary }}> · {i.branch}</span> : null}
              </>
            ),
          },
          { title: "Started", dataIndex: "openedAt", render: when },
          { title: "Ended", dataIndex: "resolvedAt", render: (val: string | null) => (val ? when(val) : <span style={{ color: v.danger }}>still open</span>) },
          { title: "Lasted", dataIndex: "duration" },
          { title: "What was missed", key: "recovery", render: (_, i) => recoveryText(i) },
          { title: "Repeated", key: "esc", render: (_, i) => <Repeated i={i} /> },
        ]}
        mobile={{
          title: (i) => KIND_LABEL[i.kind],
          subtitle: (i) => `${i.subject}${i.branch ? ` · ${i.branch}` : ""}`,
          status: (i) => <StateChip i={i} />,
          fields: [
            { label: "Started", render: (i) => when(i.openedAt) },
            { label: "Ended", render: (i) => (i.resolvedAt ? when(i.resolvedAt) : "still open") },
            { label: "Lasted", render: (i) => i.duration },
            { label: "What was missed", render: (i) => recoveryText(i) || "—" },
            { label: "Detail", render: (i) => i.detail },
          ],
          actions: (i) => (i.escalatedAt ? <Repeated i={i} /> : null),
        }}
      />
    </div>
  );
}
