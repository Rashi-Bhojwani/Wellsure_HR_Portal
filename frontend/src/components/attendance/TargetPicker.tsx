import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Form, Radio, Select } from "antd";
import { space } from "../../theme/tokens";
import { useIsPhone } from "../../ui";
import * as employeeApi from "../../api/employee";
import * as orgApi from "../../api/org";
import type { TargetValues } from "./targetSelection";

/** The "Who?" part of the attendance administration forms: everyone at a branch/department, or a list of people. */
export function TargetPicker({ fixed, known = [] }: { fixed?: { employeeId: string; name: string }; known?: Array<{ value: string; label: string }> }) {
  const form = Form.useFormInstance();
  const who = (Form.useWatch("who", form) as TargetValues["who"]) ?? "GROUP";
  const [search, setSearch] = useState("");
  const phone = useIsPhone();
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations(), enabled: !fixed });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: () => orgApi.departments.list(), enabled: !fixed });
  const { data: people } = useQuery({
    queryKey: ["employees", "picker", search],
    queryFn: () => employeeApi.listEmployees({ search: search || undefined, pageSize: 20, status: "ACTIVE" }),
    enabled: !fixed && who === "LIST",
  });
  if (fixed) return null;
  return (
    <>
      <Form.Item name="who" label="Who?">
        <Radio.Group
          style={phone ? { display: "flex", flexDirection: "column", gap: space[2] } : undefined}
          options={[{ value: "GROUP", label: "Everyone at a branch or department" }, { value: "LIST", label: "Specific employees" }]}
        />
      </Form.Item>
      {who === "GROUP" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))", gap: `0 ${space[4]}px`, maxWidth: 520 }}>
          <Form.Item name="locationId" label="Branch">
            <Select allowClear placeholder="Any branch" options={locations.map((l) => ({ value: l.id, label: l.name }))} />
          </Form.Item>
          <Form.Item name="departmentId" label="Department">
            <Select allowClear placeholder="Any department" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          </Form.Item>
        </div>
      ) : (
        <Form.Item name="employeeIds" label="Employees" style={{ maxWidth: 640 }}>
          <Select mode="multiple" aria-label="Employees" showSearch={{ filterOption: false, onSearch: setSearch }} placeholder="Search by name or code" options={[...known, ...(people?.rows ?? []).filter((e) => !known.some((k) => k.value === e.id)).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))]} />
        </Form.Item>
      )}
    </>
  );
}
