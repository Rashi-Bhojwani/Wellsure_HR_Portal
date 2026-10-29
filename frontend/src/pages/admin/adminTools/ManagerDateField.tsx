import { DatePicker, Form } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { EffectiveDateHint } from "../../../lib/effectiveDate";

// Team moves can be scheduled ahead (EF3): dated after today they're stored
// now and take effect on their day. Appointing or removing a manager changes
// a role, which is immediate — so those stay today or earlier.
const noFuture = (d: Dayjs) => d.isAfter(dayjs(), "day");

export function ManagerDateField({ name = "effectiveFrom", allowFuture = false }: { name?: string; allowFuture?: boolean }) {
  const form = Form.useFormInstance();
  const value = Form.useWatch(name, form) as Dayjs | undefined;
  return (
    <Form.Item name={name} label="Effective from" initialValue={dayjs()} extra={allowFuture ? <EffectiveDateHint value={value} /> : "Today or earlier — a role change takes effect now."} rules={[{ required: true, message: "Choose a date" }]}>
      <DatePicker style={{ width: "100%" }} format="D MMM YYYY" disabledDate={allowFuture ? undefined : noFuture} />
    </Form.Item>
  );
}
