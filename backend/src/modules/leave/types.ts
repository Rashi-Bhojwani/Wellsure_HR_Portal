import type { DataScope } from "@shared/constants/roles";
export interface LeaveViewer {
  employeeId: string;
  roleCodes: string[];
  dataScope: DataScope; // resolved per request (lib/permissions.ts)
  permissions: Set<string>;
}

export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}
