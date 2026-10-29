import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DatePicker, Form, Input, InputNumber, Select } from "antd";
import type { LetterExtraField } from "@shared/constants/letters";
import dayjs from "dayjs";
import * as employeeApi from "../../api/employee";
import { toInputNumber, toIsoDate } from "./letterUtils";

// Search-as-you-type employee picker: asks the server (by name or code) instead of loading a fixed first page, so every active employee is reachable
// however large the company. `multiple` keeps each chosen person's label while the search moves on to others.
export function EmployeePicker(props: { value?: string; onChange?: (id: string) => void; multiple?: false; placeholder?: string; id?: string } | { value?: string[]; onChange?: (ids: string[]) => void; multiple: true; placeholder?: string; id?: string }) {
  // `id` comes from Form.Item, so the field label is tied to the input (screen readers, getByLabel).
  const { multiple, placeholder, id } = props;
  const [search, setSearch] = useState("");
  const { data, isFetching } = useQuery({
    queryKey: ["employees", "picker", search],
    queryFn: () => employeeApi.listEmployees({ search: search || undefined, pageSize: 20, status: "ACTIVE" }),
    placeholderData: keepPreviousData,
  });
  const rows = data?.rows;
  // Labels of everyone seen so far (adjusted during render), so a chosen person keeps their name after the results change.
  const [seenRows, setSeenRows] = useState(rows);
  const [labels, setLabels] = useState<Record<string, string>>({});
  if (rows !== seenRows) {
    setSeenRows(rows);
    if (rows?.length) setLabels((prev) => ({ ...prev, ...Object.fromEntries(rows.map((e) => [e.id, `${e.fullName} (${e.employeeCode})`])) }));
  }
  const options = (rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }));
  const chosen = props.value === undefined ? [] : Array.isArray(props.value) ? props.value : [props.value];
  for (const id of chosen) if (labels[id] && !options.some((o) => o.value === id)) options.push({ value: id, label: labels[id] });
  const common = {
    id,
    showSearch: { filterOption: false, onSearch: setSearch },
    loading: isFetching,
    style: { width: "100%" },
    notFoundContent: isFetching ? "Searching…" : "No active employee matches",
    placeholder: placeholder ?? "Search by name or code",
    options,
  } as const;
  return multiple ? (
    <Select {...common} mode="multiple" maxTagCount="responsive" value={props.value} onChange={props.onChange} onBlur={() => setSearch("")} />
  ) : (
    <Select {...common} value={props.value} onChange={props.onChange} />
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
          getValueProps={
            f.type === "date"
              ? (val: unknown) => ({ value: toIsoDate(val) ? dayjs(toIsoDate(val)) : undefined })
              : f.type === "currency" || f.type === "number"
                ? (val: unknown) => ({ value: toInputNumber(val) })
                : undefined
          }
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
