import { Button, Checkbox, Form, Input, InputNumber, Space, Switch, TimePicker } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { DIRECTORY_CONTACT_FIELDS, DIRECTORY_CONTACT_LABELS, type PeepsSettingKey } from "@shared/constants/peeps";
import { space } from "../../theme/tokens";
import { BOOLEANS, DAYS, GIVERS, LIMITS, NUMBERS } from "./settingValues";

// One small form per Peeps setting. The server validates every value again (backend/src/modules/peeps/settingSchemas.ts).

/** The form fields for one setting. Field names are those of the value object, under "value". */
export function SettingFields({ settingKey }: { settingKey: PeepsSettingKey }) {
  const n = NUMBERS[settingKey];
  if (n) return <Form.Item name="value" label={`Value (${n.unit})`} rules={[{ required: true }]}><InputNumber min={n.min} max={n.max} style={{ width: "100%" }} /></Form.Item>;
  const b = BOOLEANS[settingKey];
  if (b) return <>{b.map((f) => <Form.Item key={f.field} name={["value", f.field]} label={f.label} valuePropName="checked" initialValue={false}><Switch /></Form.Item>)}</>;
  const g = GIVERS[settingKey];
  if (g)
    return (
      <Form.Item name={["value", g]} label="Who, besides the directors" initialValue={[]} extra="HR is never a giver. Leave both empty for the directors alone.">
        <Checkbox.Group options={[{ value: "MANAGERS", label: "Managers, to their own team" }, { value: "OFFICE", label: "Wellsure Office members allowed to" }]} />
      </Form.Item>
    );
  const l = LIMITS[settingKey];
  if (l) return <Form.Item name={["value", l]} label="At most this many per person in a calendar month" rules={[{ required: true }]}><InputNumber min={1} max={1000} style={{ width: "100%" }} /></Form.Item>;
  if (settingKey === "directory.contactFields")
    return (
      <Form.Item name="value" label="Colleagues see" initialValue={[]} extra="Personal email, addresses, pay, bank, statutory and health details never show, whatever is chosen here.">
        <Checkbox.Group options={DIRECTORY_CONTACT_FIELDS.map((f) => ({ value: f, label: DIRECTORY_CONTACT_LABELS[f] }))} />
      </Form.Item>
    );
  if (settingKey === "office.name") return <Form.Item name="value" label="Name" rules={[{ required: true, max: 60 }]}><Input /></Form.Item>;
  if (settingKey === "unmute.availability")
    return (
      <>
        <Form.Item name={["value", "days"]} label="Days" rules={[{ required: true, type: "array", min: 1, message: "Choose at least one day." }]}>
          <Checkbox.Group options={DAYS.map((d, i) => ({ value: i, label: d }))} />
        </Form.Item>
        <Space wrap size={space[4]}>
          <Form.Item name={["value", "from"]} label="From" rules={[{ required: true }]} getValueProps={(s?: string) => ({ value: s ? dayjs(s, "HH:mm") : undefined })} normalize={(d) => (d ? d.format("HH:mm") : undefined)}>
            <TimePicker format="HH:mm" minuteStep={5} />
          </Form.Item>
          <Form.Item name={["value", "to"]} label="To" rules={[{ required: true }]} getValueProps={(s?: string) => ({ value: s ? dayjs(s, "HH:mm") : undefined })} normalize={(d) => (d ? d.format("HH:mm") : undefined)}>
            <TimePicker format="HH:mm" minuteStep={5} />
          </Form.Item>
        </Space>
      </>
    );
  if (settingKey === "badges.catalogue")
    return (
      <Form.List name="value" initialValue={[{ code: "", label: "" }]}>
        {(fields, { add, remove }) => (
          <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
            {fields.map((f, i) => (
              <Space key={f.key} align="start" wrap>
                <Form.Item name={[f.name, "label"]} label={i === 0 ? "Badge" : undefined} rules={[{ required: true, max: 60 }]}><Input aria-label={`Badge ${i + 1}`} /></Form.Item>
                <Form.Item name={[f.name, "code"]} label={i === 0 ? "Code" : undefined} rules={[{ required: true, pattern: /^[A-Z0-9_]{1,40}$/, message: "Capital letters, digits, underscores." }]}><Input aria-label={`Code ${i + 1}`} /></Form.Item>
                <Form.Item name={[f.name, "description"]} label={i === 0 ? "Description" : undefined} rules={[{ max: 200 }]}><Input aria-label={`Description ${i + 1}`} /></Form.Item>
                <Form.Item label={i === 0 ? " " : undefined}><Button icon={<DeleteOutlined />} aria-label={`Remove badge ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(f.name)} /></Form.Item>
              </Space>
            ))}
            <Button icon={<PlusOutlined />} onClick={() => add({ code: "", label: "" })}>Add a badge</Button>
          </div>
        )}
      </Form.List>
    );
  return null;
}

