import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
export function useRecruitmentCacheBoundary(employeeId:string|null){const client=useQueryClient();useEffect(()=>{client.removeQueries({predicate:q=>q.queryKey[0]==='recruitment'&&(!employeeId||q.queryKey[1]!=='viewer'||q.queryKey[2]!==employeeId)});},[client,employeeId]);}
