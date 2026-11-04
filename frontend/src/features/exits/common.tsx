import { useExitQuery as useQuery } from "./useExitQuery";
import { useState, type ReactNode } from "react";

import { Form, Input, Select } from "antd";
import { SideDrawer, useDebouncedValue } from "../../ui";
import * as api from "./api";
export function OwnerSelect({value,onChange,id,multiple=false}:{value?:string|string[];onChange?:(v:string|string[])=>void;id?:string;multiple?:boolean}){
  const [q,setQ]=useState("");const search=useDebouncedValue(q,250);const people=useQuery({queryKey:["exits","owners",search],queryFn:()=>api.owners(search)});
  return <Select id={id} mode={multiple?"multiple":undefined} showSearch={{filterOption:false,onSearch:setQ}} value={value} onChange={onChange} loading={people.isFetching} placeholder="Search by name or employee code" options={people.data?.map(p=>({value:p.id,label:`${p.name} (${p.employeeCode})`}))} notFoundContent={people.error?"Could not load owners. Try searching again.":undefined}/>;
}
export function NoteDrawer({open,title,label="Reason",busy,onClose,onSubmit,children,required=true}:{open:boolean;title:string;label?:string;busy:boolean;onClose:()=>void;onSubmit:(note:string)=>void;children?:ReactNode;required?:boolean}){
  const [form]=Form.useForm();
  return <SideDrawer open={open} onClose={onClose} title={title} primaryLoading={busy} onPrimary={()=>form.submit()}><Form form={form} layout="vertical" onFinish={(v:{note:string})=>onSubmit(v.note??"")}>{children}<Form.Item name="note" label={label} rules={[{required,whitespace:required}]}><Input.TextArea rows={4} maxLength={2000}/></Form.Item></Form></SideDrawer>;
}
