import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { notifyInfo } from "./notify";
import { useSocket } from "./SocketProvider";
import type { PostRow } from "../api/engage";

// engage.post/.kudos/.reaction/.comment/.birthday/.joining/.anniversary
// (spec §8) — every event just invalidates the feed query (a follow-up
// fetch re-renders whatever's currently visible); the three celebration
// events additionally show a toast, since those are the one-per-day,
// worth-noticing moments — a reaction or comment firing a toast for
// everyone online would be noise.
export function useEngageRealtime(): void {
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;

    function invalidateFeed(): void {
      void queryClient.invalidateQueries({ queryKey: ["engage", "feed"] });
    }

    function onCelebration(kind: "birthday" | "joining" | "anniversary") {
      return (payload: PostRow) => {
        const titles = { birthday: "🎂 Birthday", joining: "🎉 New joiner", anniversary: "🏆 Work anniversary" };
        notifyInfo({ message: titles[kind], description: payload.body, placement: "topRight" });
        invalidateFeed();
      };
    }

    const onBirthday = onCelebration("birthday");
    const onJoining = onCelebration("joining");
    const onAnniversary = onCelebration("anniversary");

    socket.on("engage.post", invalidateFeed);
    socket.on("engage.kudos", invalidateFeed);
    socket.on("engage.reaction", invalidateFeed);
    socket.on("engage.comment", invalidateFeed);
    socket.on("engage.birthday", onBirthday);
    socket.on("engage.joining", onJoining);
    socket.on("engage.anniversary", onAnniversary);

    return () => {
      socket.off("engage.post", invalidateFeed);
      socket.off("engage.kudos", invalidateFeed);
      socket.off("engage.reaction", invalidateFeed);
      socket.off("engage.comment", invalidateFeed);
      socket.off("engage.birthday", onBirthday);
      socket.off("engage.joining", onJoining);
      socket.off("engage.anniversary", onAnniversary);
    };
  }, [socket, queryClient]);
}
