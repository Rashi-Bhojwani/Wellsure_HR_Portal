// @vitest-environment jsdom
import { cleanup,renderHook,waitFor,act } from "@testing-library/react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { afterEach,expect,it,vi } from "vitest";
import type { ReactNode } from "react";
import { useWork } from "../useWork";
import { useCvDownload } from "../useCvDownload";
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
it('a pending private mutation cannot navigate or invalidate through an unmounted actor',async()=>{let finish:(s:string)=>void=()=>{};const success=vi.fn(),view=renderHook(()=>useWork<string>(success),{wrapper});act(()=>view.result.current.mutate(()=>new Promise(resolve=>{finish=resolve;})));await waitFor(()=>expect(view.result.current.isPending).toBe(true));view.unmount();await act(async()=>finish('DEMO old actor'));expect(success).not.toHaveBeenCalled();});
it('a delayed CV does not start a download after its actor view unmounts',async()=>{let finish:(b:Blob)=>void=()=>{};const create=vi.fn(()=> 'blob:DEMO');vi.stubGlobal('URL',class extends URL {static createObjectURL=create;static revokeObjectURL=vi.fn();});const view=renderHook(useCvDownload,{wrapper});act(()=>view.result.current.mutate(()=>new Promise(resolve=>{finish=resolve;})));await waitFor(()=>expect(view.result.current.isPending).toBe(true));view.unmount();await act(async()=>finish(new Blob(['DEMO CV'],{type:'application/pdf'})));expect(create).not.toHaveBeenCalled();vi.unstubAllGlobals();});
