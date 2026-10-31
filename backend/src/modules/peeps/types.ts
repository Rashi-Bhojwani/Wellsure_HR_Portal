export interface ActorMeta {
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Who is acting in a Peeps route, as the access gate saw them. */
export interface PeepsActor {
  userId: string;
  employeeId: string;
  isDirector: boolean;
  /** An active Wellsure Office member (directors are not members unless appointed). */
  isMember: boolean;
  /** The member's capability ids (empty for a non-member). */
  capabilities: string[];
  roleCodes: string[];
}
