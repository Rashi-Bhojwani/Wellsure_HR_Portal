export interface ActorMeta {
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

// Every engage write path needs both ids: employeeId for FK columns
// (Post.authorEmployeeId etc.), userId for audit logs and moderatedByUserId.
export interface EngageViewer {
  employeeId: string;
  userId: string;
  permissions: Set<string>;
}
