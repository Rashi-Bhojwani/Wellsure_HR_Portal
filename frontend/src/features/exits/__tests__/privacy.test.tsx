// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExitInterviewPage } from "../ExitInterviewPage";
import { ExitsPage } from "../ExitsPage";
import * as api from "../api";
const viewer=vi.hoisted(()=>({employeeId:"DEMO_VIEWER_A"}));
vi.mock("../../../hooks/useAuth",()=>({useAuth:()=>({user:{employeeId:viewer.employeeId},hasRole:()=>false})}));
vi.mock("../../../sockets/SocketProvider",()=>({useSocket:()=>({socket:null})}));
vi.mock("../api",()=>({interview:vi.fn(),status:vi.fn(),mine:vi.fn(),myItems:vi.fn(),interviews:vi.fn()}));
function draw(interview=true, client=new QueryClient({defaultOptions:{queries:{retry:false}}})){
  const tree=()=> <QueryClientProvider client={client}><MemoryRouter initialEntries={[interview?"/app/exits/interviews/demo":"/app/exits"]}><Routes><Route path="/app/exits/interviews/:id" element={<ExitInterviewPage/>}/><Route path="/app/exits" element={<ExitsPage/>}/></Routes></MemoryRouter></QueryClientProvider>;
  const result=render(tree());return {...result,client,changeActor:()=>result.rerender(tree())};
}
afterEach(cleanup);beforeEach(()=>{viewer.employeeId="DEMO_VIEWER_A";vi.clearAllMocks();});
describe("exit screens respect the API privacy boundary",()=>{
  it("a denied interview has a forbidden state and renders no questions or answers",async()=>{vi.mocked(api.interview).mockRejectedValue({isAxiosError:true,response:{status:403}});draw();await screen.findByText("You don't have access");expect(screen.queryByText("Interview answers")).toBeNull();expect(screen.queryByRole("textbox")).toBeNull();});
  it("authorized read-only interview shows answers without employee answer controls",async()=>{vi.mocked(api.interview).mockResolvedValue({id:"demo",caseId:"case",employeeId:"own",interviewerEmployeeId:"interviewer",scheduledAt:"2098-04-01T00:00:00Z",status:"SUBMITTED",answeredAt:null,purgeAfter:null,questions:[{id:"DEMO",label:"DEMO question",required:true}],answers:{DEMO:"DEMO private answer"},canAnswer:false,canComplete:false});draw();await screen.findByText("DEMO private answer");expect(screen.queryByRole("button",{name:"Submit answers"})).toBeNull();expect(screen.queryByRole("textbox")).toBeNull();});
  it("Not set disables resignation submission and never invents a category",async()=>{vi.mocked(api.status).mockResolvedValue({submitReady:false,reasonCategories:null,canManage:false,canReadTeam:false,isDirector:false});vi.mocked(api.mine).mockResolvedValue([]);vi.mocked(api.myItems).mockResolvedValue([]);vi.mocked(api.interviews).mockResolvedValue({total:0,items:[]});draw(false);await screen.findByText("Submission is not set up");expect((screen.getByRole("button",{name:"Submit resignation"}) as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByRole("combobox")).toBeNull();});
  it("changing account never renders the previous participant's cached interview while authorization is pending",async()=>{
    vi.mocked(api.interview).mockResolvedValueOnce({id:"demo",caseId:"case",employeeId:"own",interviewerEmployeeId:"interviewer",scheduledAt:"2098-04-01T00:00:00Z",status:"SUBMITTED",answeredAt:null,purgeAfter:null,questions:[{id:"DEMO",label:"DEMO question",required:true}],answers:{DEMO:"DEMO previous account answer"},canAnswer:false,canComplete:false});
    const view=draw();await screen.findByText("DEMO previous account answer");
    let deny:(e:unknown)=>void=()=>undefined;vi.mocked(api.interview).mockImplementation(()=>new Promise((_resolve,reject)=>{deny=reject;}));
    viewer.employeeId="DEMO_VIEWER_B";view.changeActor();
    expect(screen.queryByText("DEMO previous account answer")).toBeNull();
    deny({isAxiosError:true,response:{status:403}});await screen.findByText("You don't have access");
  });
  it("leaving an interview discards its answer before reopening under a revoked relationship",async()=>{
    vi.mocked(api.interview).mockResolvedValueOnce({id:"demo",caseId:"case",employeeId:"own",interviewerEmployeeId:"interviewer",scheduledAt:"2098-04-01T00:00:00Z",status:"SUBMITTED",answeredAt:null,purgeAfter:null,questions:[{id:"DEMO",label:"DEMO question",required:true}],answers:{DEMO:"DEMO former relationship answer"},canAnswer:false,canComplete:false});
    const view=draw();await screen.findByText("DEMO former relationship answer");view.unmount();
    await waitFor(()=>expect(view.client.getQueriesData({queryKey:["exits"]})).toEqual([]));
    vi.mocked(api.interview).mockRejectedValue({isAxiosError:true,response:{status:403}});draw(true,view.client);
    expect(screen.queryByText("DEMO former relationship answer")).toBeNull();await screen.findByText("You don't have access");
  });
  it("an unfinished private resignation form is discarded when the signed-in account changes",async()=>{
    vi.mocked(api.status).mockResolvedValue({submitReady:true,reasonCategories:[{code:"DEMO",label:"DEMO reason"}],canManage:false,canReadTeam:false,isDirector:false});vi.mocked(api.mine).mockResolvedValue([]);vi.mocked(api.myItems).mockResolvedValue([]);vi.mocked(api.interviews).mockResolvedValue({total:0,items:[]});
    const view=draw(false);await screen.findByText("No resignations");fireEvent.click(screen.getByRole("button",{name:"Submit resignation"}));
    fireEvent.change(await screen.findByLabelText("Reason",{exact:true}),{target:{value:"DEMO previous account draft"}});
    viewer.employeeId="DEMO_VIEWER_B";view.changeActor();
    expect(screen.queryByDisplayValue("DEMO previous account draft")).toBeNull();
  });
});
