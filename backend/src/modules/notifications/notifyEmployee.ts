import { prisma } from "../../lib/prisma";
import { emitNotificationNew } from "../../realtime/emit";
import { createNotification } from "./service";

// Persist-then-deliver, for any module that notifies one employee: the
// Notification row is written first (the durable record the bell reads),
// then `notification.new` is emitted to their `user:{employeeId}` room as
// delivery on top. Moved here from leave/requests.ts in Phase 5 commit C so
// documents (and later modules) share the one implementation.
export async function notifyEmployee(
  targetEmployeeId: string,
  input: { type: string; title: string; body: string; link?: string | null; payload?: Record<string, unknown> },
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { employeeId: targetEmployeeId } });
  if (!user) return;
  const notification = await createNotification({ userId: user.id, ...input });
  emitNotificationNew(targetEmployeeId, {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    link: notification.link,
    createdAt: notification.createdAt.toISOString(),
  });
}
