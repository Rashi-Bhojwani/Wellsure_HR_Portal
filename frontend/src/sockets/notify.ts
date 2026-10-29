import type { notification } from "antd";

type InfoArgs = Parameters<typeof notification.info>[0];

// Live pop-ups for socket events. antd's notification (and its motion/portal code) loads on the first event rather than with the app shell, which is on a
// bundle budget (DESIGN_SYSTEM.md §7); the first pop-up arrives a moment later, nothing else changes.
export function notifyInfo(args: InfoArgs): void {
  void import("./notifyImpl").then((m) => m.notification.info(args));
}
