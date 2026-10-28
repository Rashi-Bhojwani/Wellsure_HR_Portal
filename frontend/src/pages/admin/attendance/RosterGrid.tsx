import { useState } from "react";
import dayjs from "dayjs";
import { Pagination } from "antd";
import type { RosterPreview } from "../../../api/attendanceAdmin";
import { fs, fw, radius, space, v } from "../../../theme/tokens";

type Row = RosterPreview["rows"][number];
const PAGE = 25;

/** The shift code a person works on `day` under the previewed roster (before the first segment: today's shift). */
function shiftOn(row: Row, day: string): { code: string; starts: boolean } {
  let code = row.currentShift ?? "—";
  let starts = false;
  for (const s of row.segments) {
    if (s.from > day) break;
    code = s.shift.startsWith("(") ? (row.currentShift ?? "Prev") : s.shift;
    starts = s.from === day;
  }
  return { code, starts };
}

// The roster preview as people × days: one short shift code per cell, a different shift from today's tinted, the first day of each new shift in
// bold. Sticky name column and header; scrolls inside its own box (never the page) on phones.
export function RosterGrid({ data }: { data: RosterPreview }) {
  const [page, setPage] = useState(1);
  const start = dayjs(data.start);
  // A rotation shows one day past its end too, so what happens "after that" (back to the old shift, or stay) is visible.
  const span = data.until ? Math.min(dayjs(data.until).diff(start, "day") + 1 + (data.then ? 1 : 0), 42) : 14;
  const days = Array.from({ length: Math.max(span, 1) }, (_, i) => start.add(i, "day"));
  const rows = data.rows.slice((page - 1) * PAGE, page * PAGE);
  const th = { padding: `${space[1]}px ${space[2]}px`, background: v.bgTableHeader, color: v.textSecondary, fontWeight: fw.medium, fontSize: fs.xs, borderBottom: `1px solid ${v.borderDefault}`, position: "sticky" as const, top: 0, zIndex: 1, whiteSpace: "nowrap" as const };
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space[4], marginBottom: space[3], fontSize: fs.sm, color: v.textSecondary }}>
        <span>
          {data.until && dayjs(data.until).diff(start, "day") + 1 > 42 ? "The first six weeks" : `${days.length} days`} from {start.format("D MMM")}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
          <span aria-hidden style={{ width: 14, height: 14, borderRadius: radius.xs, background: v.accentSubtle, border: `1px solid ${v.accent}` }} />
          A different shift from today's
        </span>
        <span>
          <strong style={{ color: v.textPrimary }}>Bold</strong> = first day of a new shift
        </span>
      </div>
      <div
        role="region"
        aria-label="Roster grid, scrolls sideways"
        tabIndex={0}
        style={{ overflow: "auto", maxHeight: 520, border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, maxWidth: "100%" }}
      >
        <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: fs.sm, minWidth: "100%" }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...th, left: 0, zIndex: 2, textAlign: "left", minWidth: 160 }}>
                Employee
              </th>
              <th scope="col" style={{ ...th, textAlign: "left" }}>
                Now
              </th>
              {days.map((d) => (
                <th key={d.format("YYYY-MM-DD")} scope="col" style={{ ...th, textAlign: "center", minWidth: 52 }}>
                  <div>{d.format("ddd")}</div>
                  <div style={{ color: v.textPrimary, fontWeight: fw.semibold }}>{d.format("D MMM")}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId}>
                <th
                  scope="row"
                  style={{ position: "sticky", left: 0, zIndex: 1, background: v.bgSurface, textAlign: "left", fontWeight: fw.medium, color: v.textPrimary, padding: `${space[2]}px ${space[3]}px`, borderBottom: `1px solid ${v.borderDefault}`, whiteSpace: "nowrap" }}
                >
                  {r.name}
                  <div style={{ fontSize: fs.xs, color: v.textSecondary, fontWeight: fw.regular }}>{r.employeeCode}</div>
                </th>
                <td style={{ padding: `${space[2]}px ${space[2]}px`, borderBottom: `1px solid ${v.borderDefault}`, color: v.textSecondary, whiteSpace: "nowrap" }}>{r.currentShift ?? "—"}</td>
                {days.map((d) => {
                  const iso = d.format("YYYY-MM-DD");
                  const s = shiftOn(r, iso);
                  const changed = s.code !== (r.currentShift ?? "—");
                  return (
                    <td
                      key={iso}
                      title={`${r.name}, ${d.format("ddd D MMM")}: ${s.code}${s.starts ? " (starts)" : ""}`}
                      style={{
                        padding: `${space[2]}px ${space[1]}px`,
                        textAlign: "center",
                        borderBottom: `1px solid ${v.borderDefault}`,
                        borderLeft: `1px solid ${v.borderDefault}`,
                        background: changed ? v.accentSubtle : undefined,
                        color: changed ? v.accentText : v.textBody,
                        fontWeight: s.starts ? fw.bold : fw.regular,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.code}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.rows.length > PAGE && <Pagination simple current={page} pageSize={PAGE} total={data.rows.length} onChange={setPage} style={{ marginTop: space[3], textAlign: "center" }} />}
    </div>
  );
}
