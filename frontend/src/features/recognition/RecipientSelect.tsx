import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select } from "antd";
import { useDebouncedValue } from "../../ui";
import type { PersonRef } from "./api";

/** The people this caller may give to (their team for a manager; everyone for the Wellsure Office and the directors), searched on the server. */
export function RecipientSelect({ fetcher, queryKey, value, onChange, id }: { fetcher: (q: string) => Promise<PersonRef[]>; queryKey: string; value?: string; onChange?: (v: string) => void; id?: string }) {
  const [q, setQ] = useState("");
  const search = useDebouncedValue(q, 250);
  const { data = [], isFetching } = useQuery({ queryKey: ["recognition", queryKey, search], queryFn: () => fetcher(search) });
  return <Select id={id} showSearch={{ filterOption: false, onSearch: setQ }} loading={isFetching} value={value} onChange={onChange} placeholder="Search by name or employee code" options={data.map((p) => ({ value: p.employeeId, label: `${p.name} (${p.employeeCode})` }))} />;
}
