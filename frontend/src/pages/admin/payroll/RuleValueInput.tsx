import { Input, InputNumber, Select, Space, Switch, Typography } from "antd";
import type { RuleShape } from "@shared/constants/payrollRules";
import { ROUNDING_LABEL, TYPE_LABEL, type InputState } from "./ruleValues";

const { Text } = Typography;

export function RuleValueInput({ shape, value, onChange, disabled, autoFocus }: { shape: RuleShape; value: InputState; onChange: (v: InputState) => void; disabled?: boolean; autoFocus?: boolean }) {
  switch (shape.kind) {
    case "percent":
      return <Input value={value as string} onChange={(e) => onChange(e.target.value)} suffix="%" inputMode="decimal" style={{ maxWidth: 200 }} disabled={disabled} autoFocus={autoFocus} autoComplete="off" />;
    case "money":
      return <Input value={value as string} onChange={(e) => onChange(e.target.value)} prefix="₹" inputMode="decimal" style={{ maxWidth: 240 }} disabled={disabled} autoFocus={autoFocus} autoComplete="off" />;
    case "integer":
      return <InputNumber value={value as number | null} min={shape.min} max={shape.max} precision={0} onChange={(v) => onChange(v === null ? null : Math.trunc(v))} disabled={disabled} autoFocus={autoFocus} />;
    case "choice":
      return <Select value={(value as string) || undefined} onChange={(v) => onChange(v)} options={shape.choices.map((c) => ({ value: c, label: c.replace(/_/g, " ").toLowerCase().replace(/^./, (m) => m.toUpperCase()) }))} placeholder="Choose" style={{ minWidth: 260 }} disabled={disabled} />;
    case "boolean":
      return (
        <Space>
          <Switch checked={value === true} onChange={(v) => onChange(v)} disabled={disabled} />
          <Text>{value === true ? "Yes" : value === false ? "No" : "Not chosen yet"}</Text>
        </Space>
      );
    case "text":
      return <Input value={value as string} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 320 }} disabled={disabled} autoFocus={autoFocus} autoComplete="off" />;
    case "formula":
      return <Input value={value as string} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 420, fontFamily: "monospace" }} placeholder="for example BASIC / 30" disabled={disabled} autoFocus={autoFocus} autoComplete="off" />;
    case "rounding": {
      const v = value as { mode: string; scale: number };
      return (
        <Space wrap>
          <Select value={v.mode || undefined} onChange={(mode) => onChange({ ...v, mode })} options={Object.entries(ROUNDING_LABEL).map(([k, l]) => ({ value: k, label: l }))} placeholder="Mode" style={{ minWidth: 240 }} disabled={disabled} />
          <InputNumber value={v.scale} min={0} max={6} precision={0} addonAfter="decimal places" onChange={(s) => onChange({ ...v, scale: Math.trunc(s ?? 0) })} disabled={disabled} />
        </Space>
      );
    }
    case "paymentDate": {
      const v = value as { monthOffset: number; day: number | "LAST" };
      return (
        <Space wrap>
          <Select value={v.monthOffset} onChange={(monthOffset) => onChange({ ...v, monthOffset })} options={[{ value: 0, label: "In the same month" }, { value: 1, label: "In the next month" }]} style={{ minWidth: 180 }} disabled={disabled} />
          <Select value={v.day} onChange={(day) => onChange({ ...v, day })} options={[...Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: `Day ${i + 1}` })), { value: "LAST", label: "Last day" }]} style={{ minWidth: 140 }} disabled={disabled} />
        </Space>
      );
    }
    case "employmentTypes":
      return <Select mode="multiple" value={value as string[]} onChange={(v) => onChange(v)} options={Object.entries(TYPE_LABEL).map(([k, l]) => ({ value: k, label: l }))} placeholder="Choose" style={{ minWidth: 320 }} disabled={disabled} />;
    case "json":
      return (
        <Space orientation="vertical" style={{ width: "100%" }} size={4}>
          <Input.TextArea value={value as string} onChange={(e) => onChange(e.target.value)} rows={8} style={{ fontFamily: "monospace" }} disabled={disabled} spellCheck={false} />
          <Text type="secondary" style={{ fontSize: 12 }}>Shape, for example: <code>{shape.example}</code></Text>
        </Space>
      );
  }
}
