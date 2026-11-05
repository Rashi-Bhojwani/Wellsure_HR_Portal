import { useRecruitmentQuery as useQuery } from "./useRecruitmentQuery";
import * as api from "./api";
export const required=[{required:true,message:'This field is required.'}];
export const human=(value:string)=>value.toLowerCase().replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
export const useOptions=(enabled=true)=>useQuery({queryKey:['recruitment','options'],queryFn:api.options,enabled});
