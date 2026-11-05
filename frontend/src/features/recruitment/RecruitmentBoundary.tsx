import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../hooks/useAuth";
import { useSocket } from "../../sockets/SocketProvider";
export function RecruitmentBoundary({children}:{children:ReactNode}){
 const employeeId=useAuth().user?.employeeId,{socket}=useSocket(),client=useQueryClient();const [access,setAccess]=useState(0);
 useEffect(()=>{if(!socket)return;const reset=()=>{void client.resetQueries({queryKey:['recruitment']});setAccess(v=>v+1);};const refresh=()=>{void client.invalidateQueries({queryKey:['recruitment']});};
 const critical=['permissions.changed','team.changed','recruitment.access.changed'],metadata=['recruitment.changed','recruitment.interviews.changed','recruitment.feedback.changed'];for(const event of critical)socket.on(event,reset);for(const event of metadata)socket.on(event,refresh);return()=>{for(const event of critical)socket.off(event,reset);for(const event of metadata)socket.off(event,refresh);};
 },[client,socket]);return <Fragment key={`${employeeId??'signed-out'}:${access}`}>{children}</Fragment>;
}
