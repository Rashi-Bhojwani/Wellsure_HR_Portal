import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "../../sockets/SocketProvider";
export function useExitsRealtime(){
  const {socket}=useSocket();const client=useQueryClient();
  useEffect(()=>{if(!socket)return;const refresh=()=>{void client.resetQueries({queryKey:["exits"]});};
    socket.on("permissions.changed",refresh);socket.on("team.changed",refresh);socket.on("exits.changed",refresh);socket.on("exits.interviews.changed",refresh);socket.on("exits.access.changed",refresh);
    return()=>{socket.off("permissions.changed",refresh);socket.off("team.changed",refresh);socket.off("exits.changed",refresh);socket.off("exits.interviews.changed",refresh);socket.off("exits.access.changed",refresh);};
  },[socket,client]);
}
