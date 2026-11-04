// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExitInterviewPage } from "../ExitInterviewPage";
import { ExitsPage } from "../ExitsPage";
import * as api from "../api";
vi.mock("../../../sockets/SocketProvider",()=>({useSocket:()=>({socket:null})}));
vi.mock("../api",()=>({interview:vi.fn(),status:vi.fn(),mine:vi.fn(),myItems:vi.fn(),interviews:vi.fn()}));
function draw(interview=true){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[interview?"/app/exits/interviews/demo":"/app/exits"]}><Routes><Route path="/app/exits/interviews/:id" element={<ExitInterviewPage/>}/><Route path="/app/exits" element={<ExitsPage/>}/></Routes></MemoryRouter></QueryClientProvider>);}
afterEach(cleanup);beforeEach(()=>{vi.clearAllMocks();});
describe("exit screens respect the API privacy boundary",()=>{
  it("a denied interview has a forbidden state and renders no questions or answers",async()=>{vi.mocked(api.interview).mockRejectedValue({isAxiosError:true,response:{status:403}});draw();await screen.findByText("You don't have access");expect(screen.queryByText("Interview answers")).toBeNull();expect(screen.queryByRole("textbox")).toBeNull();});
  it("authorized read-only interview shows answers without employee answer controls",async()=>{vi.mocked(api.interview).mockResolvedValue({id:"demo",caseId:"case",employeeId:"own",interviewerEmployeeId:"interviewer",scheduledAt:"2098-04-01T00:00:00Z",status:"SUBMITTED",answeredAt:null,purgeAfter:null,questions:[{id:"DEMO",label:"DEMO question",required:true}],answers:{DEMO:"DEMO private answer"},canAnswer:false,canComplete:false});draw();await screen.findByText("DEMO private answer");expect(screen.queryByRole("button",{name:"Submit answers"})).toBeNull();expect(screen.queryByRole("textbox")).toBeNull();});
  it("Not set disables resignation submission and never invents a category",async()=>{vi.mocked(api.status).mockResolvedValue({submitReady:false,reasonCategories:null,canManage:false,canReadTeam:false,isDirector:false});vi.mocked(api.mine).mockResolvedValue([]);vi.mocked(api.myItems).mockResolvedValue([]);vi.mocked(api.interviews).mockResolvedValue({total:0,items:[]});draw(false);await screen.findByText("Submission is not set up");expect((screen.getByRole("button",{name:"Submit resignation"}) as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByRole("combobox")).toBeNull();});
});
