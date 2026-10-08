import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Select, Space, Typography } from "antd";
import * as attendanceApi from "../../../api/attendance";
import type { FinalisationBlocker } from "../../../api/attendance";

const { Text } = Typography;

const TITLES: Record<FinalisationBlocker["code"], string> = {
  PLACEHOLDER_RULES: "Rule values are still placeholders",
  NOT_MARKED: "Days not marked",
  NO_SHIFT: "Days with no shift",
  NOT_UP_TO_DATE: "Days not up to date with the rules and data",
  PERIOD_NOT_OVER: "The period hasn't ended",
};

/**
 * What stands between a cycle and finalisation. The block is enforced on the
 * server (placeholder thresholds can't reach payroll unconfirmed); this card
 * shows it early. Finalisation itself is Phase 3.
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
      {data?.ready && <Alert type="success" showIcon title={`${chosen.label} has nothing blocking finalisation.`} description="Period Finalisation arrives in Phase 3." />}
      {data && !data.ready && (
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Text>
            {chosen.label} can't be finalised until {data.blockers.length === 1 ? "this is" : "these are"} resolved. The server refuses finalisation outright while any remain.
          </Text>
          {data.blockers.map((b) => (
            <Alert
              key={b.code}
              type={b.code === "PLACEHOLDER_RULES" ? "error" : "warning"}
              showIcon
              title={TITLES[b.code]}
              description={
                <>
                  <div>{b.message}</div>
                  {"days" in b && b.days.length > 0 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {b.days.slice(0, 8).map((d) => `${d.employeeName} (${d.date})`).join(", ")}
                      {b.count > 8 ? `, and ${b.count - 8} more` : ""}
                    </Text>
                  )}
                </>
              }
            />
          ))}
        </Space>
      )}
    </Card>
  );
}
