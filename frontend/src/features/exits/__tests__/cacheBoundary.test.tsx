// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { useExitCacheBoundary } from "../useExitCacheBoundary";
afterEach(cleanup);
describe("private exit cache lifetime", () => {
  it("switching account cancels the old participant's pending read and removes their data without clearing unrelated queries", async () => {
    const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
    const old = ["exits","viewer","DEMO_A","interview","DEMO_INTERVIEW"];
    client.setQueryData(old,{answers:"DEMO private answer"});
    client.setQueryData(["exits","viewer","DEMO_B","mine"],[]);
    client.setQueryData(["public-catalogue"],["DEMO public label"]);
    let finish: (value: string) => void = () => undefined;
    const pending = client.fetchQuery({queryKey:["exits","viewer","DEMO_A","pending"],queryFn:()=>new Promise<string>(resolve=>{finish=resolve;})}).catch(()=>undefined);
    const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view=renderHook(({actor}:{actor:string|null})=>useExitCacheBoundary(actor),{initialProps:{actor:"DEMO_A" as string|null},wrapper});
    view.rerender({actor:"DEMO_B"});
    await pending;
    finish("DEMO late private response");
    await waitFor(()=>expect(client.getQueriesData({queryKey:["exits","viewer","DEMO_A"]})).toEqual([]));
    expect(client.getQueryData(old)).toBeUndefined();
    expect(client.getQueryData(["public-catalogue"])).toEqual(["DEMO public label"]);
    client.setQueryData(["exits","viewer","DEMO_B","mine"],[]);
    view.rerender({actor:null});
    expect(client.getQueriesData({queryKey:["exits"]})).toEqual([]);
    expect(client.getQueryData(["public-catalogue"])).toEqual(["DEMO public label"]);
  });
});
