import { useCvDownload } from "./useCvDownload";
import { useParams, Link } from "react-router-dom";
import { Button } from "antd";
import { useState } from "react";
import { formatDateTime } from "../../lib/dates";
import { KeyValueGrid, PageHeader, Panel, QueryState, Stack } from "../../ui";
import { RecruitmentBoundary } from "./RecruitmentBoundary";
import { useRecruitmentQuery as useQuery } from "./useRecruitmentQuery";
import { ScheduleDrawer } from "./common";
import { FeedbackContent } from "./Evaluation";
import * as api from "./api";
function Content(){const {id=''}=useParams(),q=useQuery({queryKey:['recruitment','interview',id],queryFn:()=>api.interview(id),refetchOnWindowFocus:true}),row=q.data;
 const candidate=useQuery({queryKey:['recruitment','candidate',row?.candidate.id],queryFn:()=>api.candidate(row!.candidate.id),enabled:Boolean(row)}),[schedule,setSchedule]=useState(false),download=useCvDownload();
 return <><PageHeader title="Recruitment interview" back actions={<Link to="/app/recruitment/interviews">My interviews</Link>}/><QueryState isLoading={q.isLoading} error={q.error} onRetry={()=>void q.refetch()}>{row&&<Stack><Panel title={row.candidate.name} extra={row.canManage?<Button onClick={()=>setSchedule(true)}>Change schedule</Button>:undefined}><KeyValueGrid items={[{label:'Job',value:row.job.title},{label:'Round',value:row.round},{label:'Scheduled',value:formatDateTime(row.scheduledAt)}]}/>{candidate.data?.hasCv&&candidate.data.canReadCv&&<Button loading={download.isPending} onClick={()=>download.mutate(()=>api.downloadCv(row.candidate.id))}>Download CV</Button>}{row.detailsUnavailable&&<p>Candidate details and answers are unavailable under the retention rule.</p>}</Panel><FeedbackContent row={row}/></Stack>}</QueryState>{row&&schedule&&<ScheduleDrawer applicationId={row.applicationId} interview={row} onClose={()=>setSchedule(false)}/>}</>;
}
export function RecruitmentInterviewPage(){return <RecruitmentBoundary><Content/></RecruitmentBoundary>;}
