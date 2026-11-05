import { required } from "./helpers";
import { Button, Form, Input, Select } from "antd";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../lib/dates";
import { EmptyState, KeyValueGrid, Panel, QueryState, Stack } from "../../ui";

import { useRecruitmentQuery as useQuery } from "./useRecruitmentQuery";
import { useWork } from "./useWork";
import * as api from "./api";
export function FeedbackContent({row}:{row:api.Interview}){const employeeId=useAuth().user?.employeeId,feedback=useQuery({queryKey:['recruitment','feedback',row.id],queryFn:()=>api.feedback(row.id),enabled:row.canReadFeedback,refetchOnWindowFocus:true}),work=useWork();
 if(!row.canReadFeedback)return <Panel title="Private feedback"><p>Feedback is available to the panel and directors.</p></Panel>;
 return <Panel title="Interview feedback"><p>Only your feedback is shown until you submit. Submitted answers are final.</p>{row.canSubmit&&<Form layout="vertical" onFinish={(values:{answers:Record<string,string>;recommendation:string})=>work.mutate(()=>api.submitFeedback(row.id,values.answers,values.recommendation))}>{row.questions?.map(question=><Form.Item key={question.id} name={['answers',question.id]} label={question.label} rules={question.required?required:undefined}><Input.TextArea rows={4} maxLength={20000}/></Form.Item>)}<Form.Item name="recommendation" label="Recommendation" rules={required}><Select placeholder="Choose the scorecard recommendation" options={row.recommendations?.map(r=>({value:r.code,label:r.label}))}/></Form.Item><Button type="primary" htmlType="submit" loading={work.isPending}>Submit feedback</Button></Form>}<QueryState isLoading={feedback.isLoading} error={feedback.error} onRetry={()=>void feedback.refetch()}>{!feedback.data?.items.length?<EmptyState title="No visible feedback" description="Submit your feedback before reading the rest of the panel." compact/>:<Stack>{feedback.data.items.map(item=><Panel key={item.id} title={item.employeeId===employeeId?'Your submitted feedback':'Panel feedback'} subtitle={formatDateTime(item.submittedAt)}>{item.unavailable?<p>Feedback is unavailable under the retention rule.</p>:<><KeyValueGrid columns={1} items={(row.questions??[]).map(question=>({label:question.label,value:item.answers?.[question.id]??'—'}))}/><p>Recommendation: {row.recommendations?.find(r=>r.code===item.recommendation)?.label??item.recommendation}</p></>}</Panel>)}</Stack>}</QueryState></Panel>;
}
export function InterviewEvaluation({id}:{id:string}){const q=useQuery({queryKey:['recruitment','interview',id],queryFn:()=>api.interview(id),refetchOnWindowFocus:true});return <QueryState isLoading={q.isLoading} error={q.error} onRetry={()=>void q.refetch()}>{q.data&&<FeedbackContent row={q.data}/>}</QueryState>;}
