import { useState } from "react";
import dayjs from "dayjs";
import { Button, Input, Select, Typography } from "antd";
import { EditOutlined, LockOutlined } from "@ant-design/icons";
import { parseMusterCell } from "@shared/attendance/muster";
import type { Muster, MusterCell, MusterRow } from "../../../../api/muster";
import { DataTable } from "../../../../ui";
import { fs, fw, radius, space, v } from "../../../../theme/tokens";
import { statusTone } from "../../../../components/attendance/statusTone";
import { cellKey } from "./musterCells";

const { Text } = Typography;

interface Props {
  muster: Muster;
  pending: Record<string, string>;
  errors: Record<string, string>;
  onChange: (key: string, text: string | null) => void;
  onOpenDay?: (row: MusterRow, cell: MusterCell) => void;
}

/**
 * The muster for one day (phones, and anyone who marks a branch a day at a time): one row or card per person, with the same
 * text input as the grid (IN-OUT times or a status letter) feeding the same unsaved changes and Save bar.
 */
export function MusterDayList({ muster, pending, errors, onChange, onOpenDay }: Props) {
  const initial = muster.days.some((d) => d.date === muster.today) ? muster.today : muster.days[muster.days.length - 1]?.date;
  const [date, setDate] = useState<string | undefined>(initial);
  const idx = muster.days.findIndex((d) => d.date === date);
  type Item = { row: MusterRow; cell: MusterCell };
  const items: Item[] = idx < 0 ? [] : muster.rows.map((row) => ({ row, cell: row.cells[idx]! })).filter((x) => x.cell);

  const codeChip = (cell: MusterCell) => {
    const t = statusTone(cell.code);
    return cell.code ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: space[1], background: t.bg, color: t.fg, borderRadius: radius.xs, padding: "1px 8px", fontWeight: fw.bold, fontSize: fs.sm }}>
        {cell.code}
        {cell.locked && <LockOutlined aria-label="finalised" />}
      </span>
    ) : (
      <Text type="secondary">—</Text>
    );
  };
  const entry = ({ row, cell }: Item) => {
    const key = cellKey(row.employeeId, cell.date);
    const edited = pending[key];
    if (!cell.editable) {
      const openable = !!onOpenDay && cell.capture === "DEVICE" && !!cell.code && !cell.locked;
      return openable ? (
        <Button size="small" icon={<EditOutlined />} onClick={() => onOpenDay!(row, cell)}>
          Set this day
        </Button>
      ) : (
        <Text type="secondary" style={{ fontSize: fs.sm }}>
          {cell.capture === "DEVICE" ? "biometric device" : (cell.reason ?? "read-only")}
        </Text>
      );
    }
    const error = errors[key] ?? (edited !== undefined && edited !== "" ? (() => { const p = parseMusterCell(edited); return p.ok ? null : p.error; })() : null);
    return (
      <div style={{ minWidth: 0 }}>
        <Input
          aria-label={`${row.name}, ${dayjs(cell.date).format("ddd D MMM")}: IN-OUT times or a status`}
          aria-invalid={error ? true : undefined}
          status={error ? "error" : edited !== undefined ? "warning" : undefined}
          value={edited ?? cell.entry?.text ?? ""}
          placeholder={edited === "" ? "clear" : cell.offDayOnly ? "W or 10:00-19:00" : "10:00-19:00 or P"}
          onChange={(e) => onChange(key, e.target.value)}
          onBlur={() => {
            if (edited !== undefined && edited === (cell.entry?.text ?? "")) onChange(key, null);
          }}
          style={{ maxWidth: 220, background: edited !== undefined ? v.warningSubtle : undefined }}
        />
        {error && <div style={{ color: v.danger, fontSize: fs.sm, marginTop: 2 }}>{error}</div>}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
      <Select
        aria-label="Day to mark"
        value={date}
        onChange={setDate}
        style={{ width: "100%", maxWidth: 280 }}
        options={muster.days.map((d) => ({ value: d.date, label: `${dayjs(d.date).format("ddd, D MMM")}${d.notMarked ? ` · ${d.notMarked} not marked` : ""}` }))}
      />
      <DataTable<Item>
        density="compact"
        rowKey={(x) => x.row.employeeId}
        dataSource={items}
        pagination={false}
        mobile={{
          title: (x) => x.row.name,
          subtitle: (x) => `${x.row.employeeCode}${x.row.branch ? ` · ${x.row.branch}` : ""}`,
          status: (x) => codeChip(x.cell),
          fields: [{ label: "Times", render: (x) => (x.cell.firstIn ? `${x.cell.firstIn}–${x.cell.lastOut ?? "no OUT"}` : "—") }],
          actions: (x) => <div style={{ width: "100%" }}>{entry(x)}</div>,
        }}
        columns={[
          {
            title: "Employee",
            key: "name",
            render: (_, x) => (
              <span>
                <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{x.row.name}</div>
                <div style={{ color: v.textSecondary, fontSize: fs.sm }}>
                  {x.row.employeeCode}
                  {x.row.branch ? ` · ${x.row.branch}` : ""}
                </div>
              </span>
            ),
          },
          { title: "Now", key: "code", render: (_, x) => codeChip(x.cell) },
          { title: "Times", key: "times", render: (_, x) => (x.cell.firstIn ? <span className="ws-num">{`${x.cell.firstIn}–${x.cell.lastOut ?? "no OUT"}`}</span> : "—") },
          { title: "Mark", key: "mark", render: (_, x) => entry(x) },
        ]}
      />
    </div>
  );
}
