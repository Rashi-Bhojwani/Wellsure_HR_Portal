import { useExitsRealtime } from "./useExitsRealtime";
import { human } from "./helpers";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input } from "antd";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";
import { KeyValueGrid, PageHeader, Panel, QueryState, Stack, StatusChip, toast } from "../../ui";
import * as api from "./api";

export function ExitInterviewPage(){
  useExitsRealtime();const {id=""}=useParams();const client=useQueryClient();
  const q=useQuery({queryKey:["exits","interviews",id],queryFn:()=>api.interview(id),refetchOnWindowFocus:true});
  const action=useMutation({mutationFn:(work:()=>Promise<unknown>)=>work(),onSuccess:()=>{void client.resetQueries({queryKey:["exits"]});toast.success("Interview updated.");},onError:e=>toast.error(apiErrorMessage(e,"Could not update the interview."))});
  const row=q.data;
  return <><PageHeader title="Private exit interview" back actions={<Link to="/app/exits">Back to moving on</Link>}/><QueryState isLoading={q.isLoading} error={q.error} onRetry={()=>void q.refetch()}>{row&&<Stack><Panel title="Interview" extra={<StatusChip>{human(row.status)}</StatusChip>}><KeyValueGrid items={[{label:"Scheduled",value:formatDateTime(row.scheduledAt)},{label:"Answered",value:row.answeredAt?formatDateTime(row.answeredAt):"Not yet"},{label:"Answers retained until",value:row.purgeAfter?formatDateTime(row.purgeAfter):"Chosen when answers are submitted"}]}/><p>Answers are visible to you, the employee or interviewer in this interview, and directors. Director openings are audited.</p></Panel><Panel title={row.canAnswer?"Your answers":"Interview answers"}>{row.canAnswer?<Form layout="vertical" onFinish={(v:Record<string,string>)=>action.mutate(()=>api.answer(id,v))}>{row.questions?.map(question=><Form.Item key={question.id} name={question.id} label={question.label} rules={[{required:question.required,whitespace:question.required}]}><Input.TextArea rows={4} maxLength={20000}/></Form.Item>)}<Button type="primary" htmlType="submit" loading={action.isPending}>Submit answers</Button></Form>:<KeyValueGrid columns={1} items={row.questions?.map(question=>({label:question.label,value:row.answers?.[question.id]??(row.status==="PURGED"?"Removed under the retention rule":"Not answered")}))??[]}/>}</Panel>{row.canComplete&&<Panel title="Complete interview"><Button type="primary" loading={action.isPending} onClick={()=>action.mutate(()=>api.completeInterview(id))}>Mark interview complete</Button></Panel>}</Stack>}</QueryState></>;
}
