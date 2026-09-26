export interface RequestMetaInput {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface DeviceCodeCheckResult {
  deviceUserId: string;
  suggestedEmployeeCode: string;
  collision: { employeeCode: string; fullName: string; separatedOn: string | null } | null;
}
