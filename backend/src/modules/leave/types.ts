export interface LeaveViewer {
  employeeId: string;
  roleCodes: string[];
  permissions: Set<string>;
}

export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}
