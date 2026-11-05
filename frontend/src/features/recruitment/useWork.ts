import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "../../lib/apiError";
import { errorStatus, toast } from "../../ui";
export function useWork<T=unknown>(onSuccess?:(value:T)=>void){const client=useQueryClient(),alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 return useMutation({mutationFn:(work:()=>Promise<T>)=>work(),onSuccess:value=>{if(!alive.current)return;void client.invalidateQueries({queryKey:['recruitment']});onSuccess?.(value);},onError:error=>{if(!alive.current)return;if([403,404].includes(errorStatus(error)??0))void client.resetQueries({queryKey:['recruitment']});toast.error(apiErrorMessage(error,'Could not save this recruitment change.'));}});
}
