import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DatePicker, Form, Input, InputNumber, Select } from "antd";
import type { LetterExtraField } from "@shared/constants/letters";
import * as employeeApi from "../../api/employee";

// Search-as-you-type employee picker (for previews).
export function EmployeePicker({ value, onChange }: { value?: string; onChange?: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const { data, isFetching } = useQuery({
    queryKey: ["employees", "picker", search],
    queryFn: () => employeeApi.listEmployees({ search: search || undefined, pageSize: 20, status: "ACTIVE" }),
  });
  return (
    <Select
      showSearch={{ filterOption: false, onSearch: setSearch }}
      value={value}
      onChange={onChange}
      loading={isFetching}
      placeholder="Search by name or code"
      options={(data?.rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))}
    />
  );
}

// One input per typed field. Everything is sent as a string; the server
// validates and formats (₹ with Indian grouping, dates in words).
export function ExtraFieldInputs({ fields, namePrefix = "extraValues" }: { fields: LetterExtraField[]; namePrefix?: string }) {
  return (
    <>
      {fields.map((f) => (
        <Form.Item
          key={f.key}
          name={[namePrefix, f.key]}
          label={f.label}
          rules={f.required ? [{ required: true, message: `${f.label} is required.` }] : []}
          getValueFromEvent={f.type === "date" ? (d: { format: (s: string) => string } | null) => (d ? d.format("YYYY-MM-DD") : "") : undefined}
          getValueProps={f.type === "date" ? () => ({}) : undefined}
        >
          {f.type === "currency" ? (
            <InputNumber min={0} style={{ width: "100%" }} prefix="₹" />
          ) : f.type === "number" ? (
            <InputNumber style={{ width: "100%" }} />
          ) : f.type === "date" ? (
            <DatePicker style={{ width: "100%" }} />
          ) : (
            <Input maxLength={2000} />
          )}
        </Form.Item>
      ))}
    </>
  );
}
