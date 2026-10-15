import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Form, Radio, Select, Space } from "antd";
import * as employeeApi from "../../api/employee";
import * as orgApi from "../../api/org";
import type { TargetValues } from "./targetSelection";


/** The "Who?" part of the attendance administration forms: everyone at a branch/department, or a list of people. */
export function TargetPicker({ fixed }: { fixed?: { employeeId: string; name: string } }) {
  const form = Form.useFormInstance();
  const who = (Form.useWatch("who", form) as TargetValues["who"]) ?? "GROUP";
  const [search, setSearch] = useState("");
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
        <Radio.Group options={[{ value: "GROUP", label: "Everyone at a branch or department" }, { value: "LIST", label: "Specific employees" }]} />
      </Form.Item>
      {who === "GROUP" ? (
        <Space wrap>
          <Form.Item name="locationId" label="Branch">
            <Select allowClear placeholder="Any branch" style={{ width: 240 }} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
          </Form.Item>
          <Form.Item name="departmentId" label="Department">
            <Select allowClear placeholder="Any department" style={{ width: 240 }} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          </Form.Item>
        </Space>
      ) : (
        <Form.Item name="employeeIds" label="Employees">
          <Select mode="multiple" showSearch={{ filterOption: false, onSearch: setSearch }} placeholder="Search by name or code" options={(people?.rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))} />
        </Form.Item>
      )}
    </>
  );
}
