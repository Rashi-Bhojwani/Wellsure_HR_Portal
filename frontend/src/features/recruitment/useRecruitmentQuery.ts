import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useAuth } from "../../hooks/useAuth";
export function useRecruitmentQuery<T>(options:Omit<UseQueryOptions<T>,"enabled"|"placeholderData">&{enabled?:boolean}){
 const employeeId=useAuth().user?.employeeId;
 return useQuery<T>({...options,gcTime:0,queryKey:["recruitment","viewer",employeeId,...options.queryKey.slice(1)],enabled:Boolean(employeeId)&&options.enabled!==false});
}
