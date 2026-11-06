import { useState } from "react";
import dayjs from "dayjs";
import { useQuery } from "@tanstack/react-query";
import { Button, Pagination, Select } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import * as muster from "../../../api/muster";
import { exportRosterMonth, rosterMonth, type RosterMonth } from "../../../api/workforce";
import { apiErrorMessage } from "../../../lib/apiError";
import { Panel, QueryState, SkeletonTable, toast } from "../../../ui";
import { fs, fw, radius, space, v } from "../../../theme/tokens";

const PAGE = 25;
type Cell = RosterMonth["rows"][number]["cells"][number];

function cellText(c: Cell): string {
  if (c.kind === "NOT_EMPLOYED") return "";
  if (c.kind === "NO_ASSIGNMENT") return "–";
  if (c.kind === "OFF") return "Off";
  if (c.kind === "HOLIDAY") return "Hol";
  return `${c.shiftCode ?? ""}${c.overridden ? "*" : ""}`;
}
function cellTitle(name: string, c: Cell): string {
  const when = dayjs(c.date).format("ddd D MMM");
  if (c.kind === "NOT_EMPLOYED") return `${name}, ${when}: not employed`;
  if (c.kind === "NO_ASSIGNMENT") return `${name}, ${when}: no shift assigned`;
  const what = c.kind === "OFF" ? "week-off" : c.kind === "HOLIDAY" ? "holiday" : "working day";
  return `${name}, ${when}: ${what}, shift ${c.shiftCode}${c.overridden ? " (Shift Override)" : ""}`;
}

// A-10 G2: the roster as it stands, read-only, one attendance cycle at a time (people × days: the shift code, Off, Hol). Scrolls inside its own box on phones.
export function RosterMonthPanel() {
  const [cycleStart, setCycleStart] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const cycles = useQuery({ queryKey: ["muster-cycles"], queryFn: muster.cycles });
  const grid = useQuery({ queryKey: ["roster-month", cycleStart ?? "current"], queryFn: () => rosterMonth({ cycleStart }) });
  const th = { padding: `${space[1]}px ${space[2]}px`, background: v.bgTableHeader, color: v.textSecondary, fontWeight: fw.medium, fontSize: fs.xs, borderBottom: `1px solid ${v.borderDefault}`, position: "sticky" as const, top: 0, zIndex: 1, whiteSpace: "nowrap" as const };
  const g = grid.data;
  const rows = g ? g.rows.slice((page - 1) * PAGE, page * PAGE) : [];
  const download = async () => {
    setBusy(true);
    try {
      muster.saveBlob(await exportRosterMonth({ cycleStart }), `roster-${g?.cycle.start ?? "cycle"}.xlsx`);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not download the roster."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="Roster for a cycle"
      subtitle="Read-only: each person's shift on each day, week-offs and holidays, as attendance is worked out. * = a Shift Override for that day."
      extra={
        <div style={{ display: "flex", flexWrap: "wrap", gap: space[2] }}>
          <Select
            aria-label="Attendance cycle"
            style={{ minWidth: 200 }}
            loading={cycles.isLoading}
            value={cycleStart ?? cycles.data?.current.start}
            options={(cycles.data?.cycles ?? []).map((c) => ({ value: c.start, label: c.label }))}
            onChange={(val: string) => {
              setCycleStart(val);
              setPage(1);
            }}
          />
          <Button icon={<DownloadOutlined />} onClick={() => void download()} loading={busy} disabled={!g}>
            Download
          </Button>
        </div>
      }
    >
      <QueryState isLoading={grid.isLoading} error={grid.error} onRetry={() => void grid.refetch()} skeleton={<SkeletonTable rows={6} columns={8} />} isEmpty={!!g && g.rows.length === 0} empty={<div style={{ color: v.textSecondary }}>Nobody you can see is employed in this cycle.</div>}>
        {g && (
          <>
            {g.legend.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: space[4], marginBottom: space[3], fontSize: fs.sm, color: v.textSecondary }}>
                {g.legend.map((l) => (
                  <span key={l.code}>
                    <strong style={{ color: v.textPrimary }}>{l.code}</strong> {l.name} {l.startTime}–{l.endTime}
                  </span>
                ))}
              </div>
            )}
            <div role="region" aria-label="Roster for the cycle, scrolls sideways" tabIndex={0} style={{ overflow: "auto", maxHeight: 520, border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, maxWidth: "100%" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: fs.sm, minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th scope="col" style={{ ...th, left: 0, zIndex: 2, textAlign: "left", minWidth: 160 }}>
                      Employee
                    </th>
                    {g.days.map((d) => (
                      <th key={d} scope="col" style={{ ...th, textAlign: "center", minWidth: 44 }}>
                        <div>{dayjs(d).format("dd")}</div>
                        <div style={{ color: v.textPrimary, fontWeight: fw.semibold }}>{dayjs(d).format("D")}</div>
                      </th>
                    ))}
                    <th scope="col" style={{ ...th, textAlign: "right" }}>
                      Work
                    </th>
                    <th scope="col" style={{ ...th, textAlign: "right" }}>
                      Off
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.employeeId}>
                      <th scope="row" style={{ position: "sticky", left: 0, zIndex: 1, background: v.bgSurface, textAlign: "left", fontWeight: fw.medium, color: v.textPrimary, padding: `${space[2]}px ${space[3]}px`, borderBottom: `1px solid ${v.borderDefault}`, whiteSpace: "nowrap" }}>
                        {r.name}
                        <div style={{ fontSize: fs.xs, color: v.textSecondary, fontWeight: fw.regular }}>{r.employeeCode}</div>
                      </th>
                      {r.cells.map((c) => (
                        <td
                          key={c.date}
                          title={cellTitle(r.name, c)}
                          style={{
                            padding: `${space[2]}px ${space[1]}px`,
                            textAlign: "center",
                            borderBottom: `1px solid ${v.borderDefault}`,
                            borderLeft: `1px solid ${v.borderDefault}`,
                            background: c.kind === "OFF" || c.kind === "HOLIDAY" ? v.bgSubtle : c.overridden ? v.accentSubtle : undefined,
                            color: c.kind === "WORK" ? (c.overridden ? v.accentText : v.textBody) : v.textSecondary,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {cellText(c)}
                        </td>
                      ))}
                      <td style={{ padding: `${space[2]}px ${space[2]}px`, borderBottom: `1px solid ${v.borderDefault}`, textAlign: "right" }}>{r.workDays}</td>
                      <td style={{ padding: `${space[2]}px ${space[2]}px`, borderBottom: `1px solid ${v.borderDefault}`, textAlign: "right" }}>{r.offDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {g.rows.length > PAGE && <Pagination simple current={page} pageSize={PAGE} total={g.rows.length} onChange={setPage} style={{ marginTop: space[3], textAlign: "center" }} />}
          </>
        )}
      </QueryState>
    </Panel>
  );
}
