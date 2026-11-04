import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select } from "antd";
import * as employeeApi from "../../../../api/employee";
import { useDebouncedValue } from "../../../../ui";

// A-9: pick people by name or code. The search is the All Employees grid's, so it only ever finds people in the viewer's own scope.
export function PeoplePicker({ value = [], onChange = () => undefined, max, ariaLabel = "People" }: { value?: string[]; onChange?: (ids: string[]) => void; max?: number; ariaLabel?: string }) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 250);
  const found = useQuery({ queryKey: ["segments", "people", q], queryFn: () => employeeApi.listEmployees({ search: q || undefined, page: 1, pageSize: 20, sortBy: "employeeCode", sortDir: "asc" }), enabled: q.trim().length >= 2 });
  const [labels, setLabels] = useState<Record<string, string>>({});
  const options = (found.data?.rows ?? []).map((r) => ({ value: r.id, label: `${r.fullName} (${r.employeeCode})` }));
  return (
    <Select
      mode="multiple"
      aria-label={ariaLabel}
      maxCount={max}
      placeholder="Type at least two letters of a name or code"
      showSearch={{ filterOption: false, onSearch: setSearch }}
      value={value}
      onChange={(ids: string[]) => {
        setLabels((prev) => ({ ...prev, ...Object.fromEntries(options.map((o) => [o.value, o.label])) }));
        onChange(ids);
      }}
      options={[...options, ...value.filter((id) => !options.some((o) => o.value === id)).map((id) => ({ value: id, label: labels[id] ?? id }))]}
      loading={found.isFetching}
      notFoundContent={q.trim().length >= 2 ? "Nobody found" : "Type to search"}
      style={{ width: "100%" }}
    />
  );
}

