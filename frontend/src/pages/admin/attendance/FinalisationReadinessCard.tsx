import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Select } from "antd";
import { useNavigate } from "react-router-dom";
import * as attendanceApi from "../../../api/attendance";
import { FinalisationBlockers } from "../../../components/attendance/FinalisationBlockers";
import { fs, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, Panel, QueryState, Skel, useIsPhone } from "../../../ui";

/**
 * What stands between a cycle and finalisation. The block is enforced on the
 * server (placeholder thresholds can't reach payroll unconfirmed); this panel
 * shows it early; the period is finalised on its own screen (Attendance Period Finalisation).
 */
export function FinalisationReadinessCard() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const { data: cycle } = useQuery({ queryKey: ["attendance", "config", "cycle"], queryFn: attendanceApi.getCycle });
  const [picked, setPicked] = useState<string | null>(null);
  const cycles = cycle?.recent ?? [];
  const chosen = cycles.find((c) => c.start === picked) ?? cycles[1] ?? cycles[0];
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["attendance", "finalisation", chosen?.start, chosen?.end],
    queryFn: () => attendanceApi.finalisationReadiness(chosen!.start, chosen!.end),
    enabled: !!chosen,
  });
  if (!chosen) return null;
  return (
    <Panel
      title="Ready to finalise?"
      subtitle="What still blocks a cycle from being locked for payroll"
      extra={
        <Select aria-label="Attendance cycle" style={{ width: phone ? "100%" : 200 }} value={chosen.start} onChange={setPicked} options={cycles.map((c) => ({ value: c.start, label: c.label }))} />
      }
    >
      <QueryState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        compact
        skeleton={
          <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
            <Skel h={56} r={radius.md} />
            <Skel h={56} r={radius.md} />
          </div>
        }
      >
        {data?.ready && (
          <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
            <ApprovalBanner
              tone="success"
              title={`${chosen.label} has nothing blocking finalisation.`}
              description="Finalising locks every day in it, so what payroll reads cannot change."
              actions={<Button onClick={() => navigate("/admin/workforce/attendance/finalisation")}>Go to finalisation</Button>}
            />
            {data.warnings.length > 0 && <FinalisationBlockers readiness={{ ...data, blockers: [] }} />}
          </div>
        )}
        {data && !data.ready && (
          <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
            <p style={{ margin: 0, color: v.textBody, fontSize: fs.md }}>
              {chosen.label} can't be finalised until {data.blockers.length === 1 ? "this is" : "these are"} resolved. The server refuses finalisation outright while any remain.
            </p>
            <FinalisationBlockers readiness={data} />
          </div>
        )}
      </QueryState>
    </Panel>
  );
}
