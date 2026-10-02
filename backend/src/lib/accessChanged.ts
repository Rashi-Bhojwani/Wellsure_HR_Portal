import { PERMISSION_KEYS } from "@shared/constants/permissions";
import { emitPermissionsChanged } from "../realtime/emit";
import { resolveAccess } from "./permissions";

// After someone's roles, a role's definition or their per-user exceptions
// change: move their live sockets to the right permission rooms and tell
// their browser to refetch /me (E1). Shared by the access and managers
// modules.
export async function notifyAccessChanged(users: Array<{ id: string; employeeId: string }>): Promise<void> {
  for (const u of users) {
    const access = await resolveAccess(u.id);
    emitPermissionsChanged(u.employeeId, access.permissions, PERMISSION_KEYS);
  }
}
