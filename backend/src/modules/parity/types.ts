import type { DataScope } from "@shared/constants/roles";

export interface ParityViewer {
  userId: string;
  employeeId: string;
  roleCodes: string[];
  dataScope: DataScope;
  permissions: Set<string>;
}
export interface ParityMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}
export const isDirector = (v: Pick<ParityViewer, "roleCodes">) => v.roleCodes.includes("SUPER_ADMIN");
