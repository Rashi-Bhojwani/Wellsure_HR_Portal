import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Select, Space, Typography } from "antd";
import * as attendanceApi from "../../../api/attendance";
import { Link } from "react-router-dom";
import { FinalisationBlockers } from "../../../components/attendance/FinalisationBlockers";

const { Text } = Typography;

/**
 * What stands between a cycle and finalisation. The block is enforced on the
 * server (placeholder thresholds can't reach payroll unconfirmed); this card
 * shows it early; the period is finalised on its own screen (Attendance Period Finalisation).
 */
export function FinalisationReadinessCard() {
  const { data: cycle } = useQuery({ queryKey: ["attendance", "config", "cycle"], queryFn: attendanceApi.getCycle });
  const [picked, setPicked] = useState<string | null>(null);
  const cycles = cycle?.recent ?? [];
  const chosen = cycles.find((c) => c.start === picked) ?? cycles[1] ?? cycles[0];
  const { data } = useQuery({
    queryKey: ["attendance", "finalisation", chosen?.start, chosen?.end],
    queryFn: () => attendanceApi.finalisationReadiness(chosen!.start, chosen!.end),
    enabled: !!chosen,
  });
  if (!chosen) return null;
  return (
    <Card
      size="small"
      title="Ready to finalise?"
      extra={<Select size="small" aria-label="Attendance cycle" style={{ width: 200 }} value={chosen.start} onChange={setPicked} options={cycles.map((c) => ({ value: c.start, label: c.label }))} />}
    >
      {data?.ready && (
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Alert type="success" showIcon title={`${chosen.label} has nothing blocking finalisation.`} description={<Link to="/admin/workforce/attendance/finalisation">Finalise it on Attendance Period Finalisation</Link>} />
          {data.warnings.length > 0 && <FinalisationBlockers readiness={{ ...data, blockers: [] }} />}
        </Space>
      )}
      {data && !data.ready && (
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Text>
            {chosen.label} can't be finalised until {data.blockers.length === 1 ? "this is" : "these are"} resolved. The server refuses finalisation outright while any remain.
          </Text>
          <FinalisationBlockers readiness={data} />
        </Space>
      )}
    </Card>
  );
}
