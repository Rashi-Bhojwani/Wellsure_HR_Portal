export interface CreateNotificationInput {
  userId: string;
  type: string; // namespaced event-shaped string, e.g. "leave.decided" — see schema.prisma's comment on Notification
  title: string;
  body: string;
  link?: string | null;
  payload?: Record<string, unknown> | null;
}
