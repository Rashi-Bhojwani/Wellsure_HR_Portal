import { apiClient } from "../../api/client";

/** HR or a director removes someone else's photo, with a reason (audited). Only the person adds or changes their own. */
export async function removeAvatar(employeeId: string, reason: string): Promise<{ removed: boolean }> {
  const { data } = await apiClient.post<{ removed: boolean }>(`/api/avatars/${employeeId}/remove`, { reason });
  return data;
}
