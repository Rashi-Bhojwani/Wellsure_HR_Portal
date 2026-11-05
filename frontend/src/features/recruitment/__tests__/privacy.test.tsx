// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { cleanup,render,screen,fireEvent } from "@testing-library/react";
import { MemoryRouter,Route,Routes } from "react-router-dom";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { RecruitmentInterviewPage } from "../RecruitmentInterviewPage";
import * as api from "../api";
const viewer=vi.hoisted(()=>({employeeId:'DEMO_A'}));
vi.mock('../../../hooks/useAuth',()=>({useAuth:()=>({user:{employeeId:viewer.employeeId}})}));
vi.mock('../../../sockets/SocketProvider',()=>({useSocket:()=>({socket:null})}));
vi.mock('../api',()=>({candidate:vi.fn(),interview:vi.fn(),feedback:vi.fn(),submitFeedback:vi.fn()}));
const row:api.Interview={id:'demo',applicationId:'a',candidate:{id:'c',name:'DEMO candidate'},job:{id:'j',title:'DEMO job'},round:'DEMO round',scheduledAt:'2098-04-01T00:00:00Z',status:'SCHEDULED',panelEmployeeIds:['DEMO_A'],canManage:false,canReadFeedback:true,canSubmit:true,detailsUnavailable:false,questions:[{id:'DEMO',label:'DEMO question',required:true}],recommendations:[{code:'DEMO_YES',label:'DEMO progress'}]};
function draw(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const tree=()=> <QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/recruitment/interviews/demo']}><Routes><Route path='/app/recruitment/interviews/:id' element={<RecruitmentInterviewPage/>}/></Routes></MemoryRouter></QueryClientProvider>;const view=render(tree());return {...view,client,changeActor:()=>view.rerender(tree())};}
afterEach(cleanup);beforeEach(()=>{viewer.employeeId='DEMO_A';vi.resetAllMocks();vi.mocked(api.candidate).mockResolvedValue({id:'c',name:'DEMO candidate',anonymized:false,expired:false,createdAt:'2098-04-01',canManage:false});});
describe('recruitment UI confidential boundary',()=>{
 it('denied metadata renders no questions or feedback request',async()=>{vi.mocked(api.interview).mockRejectedValue({isAxiosError:true,response:{status:403}});draw();await screen.findByText("You don't have access");expect(api.feedback).not.toHaveBeenCalled();expect(screen.queryByRole('textbox')).toBeNull();});
 it('HR nonpanel metadata never triggers a feedback fetch',async()=>{vi.mocked(api.interview).mockResolvedValue({...row,canManage:true,canReadFeedback:false,canSubmit:false,questions:undefined});draw();await screen.findByText('Feedback is available to the panel and directors.');expect(api.feedback).not.toHaveBeenCalled();expect(screen.queryByText('DEMO question')).toBeNull();});
 it('unsubmitted panel has only own blank form and empty feedback',async()=>{vi.mocked(api.interview).mockResolvedValue(row);vi.mocked(api.feedback).mockResolvedValue({canReadPanel:false,items:[]});draw();await screen.findByText('No visible feedback');expect(screen.queryByText('Panel feedback')).toBeNull();expect((screen.getByLabelText('DEMO question') as HTMLTextAreaElement).value).toBe('');});
 it('account change removes answers while the new authorization request is pending',async()=>{vi.mocked(api.interview).mockResolvedValue({...row,canSubmit:false});vi.mocked(api.feedback).mockResolvedValue({canReadPanel:true,items:[{id:'f',employeeId:'DEMO_A',submittedAt:'2098-04-01',answers:{DEMO:'DEMO_PRIVATE'},recommendation:'DEMO_YES',unavailable:false,removed:false}]});const v=draw();await screen.findByText('DEMO_PRIVATE');vi.mocked(api.interview).mockImplementation(()=>new Promise(()=>{}));viewer.employeeId='DEMO_B';v.changeActor();expect(screen.queryByText('DEMO_PRIVATE')).toBeNull();});
 it('account change discards an unfinished feedback draft',async()=>{vi.mocked(api.interview).mockResolvedValue(row);vi.mocked(api.feedback).mockResolvedValue({canReadPanel:false,items:[]});const v=draw();fireEvent.change(await screen.findByLabelText('DEMO question'),{target:{value:'DEMO old draft'}});viewer.employeeId='DEMO_B';v.changeActor();expect(screen.queryByDisplayValue('DEMO old draft')).toBeNull();});
});
