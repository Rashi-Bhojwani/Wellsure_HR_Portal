import { apiClient } from "../../api/client";

/** HR or a director removes someone else's photo, with a reason (audited). Only the person adds or changes their own. */
export async function removeAvatar(employeeId: string, reason: string): Promise<{ removed: boolean }> {
  const { data } = await apiClient.post<{ removed: boolean }>(`/api/avatars/${employeeId}/remove`, { reason });
  return data;
}

// D-35: avatar choices and My profile.
export type AvatarKind = "PHOTO" | "INITIALS" | "CHARACTER" | "FUN";
export interface AvatarView {
  kind: AvatarKind;
  catalogueId: string | null;
  file: string | null;
}
export interface AvatarCatalogue {
  placeholder: boolean;
  basePath: string;
  characters: Array<{ id: string; name: string; file: string }>;
  fun: Array<{ id: string; name: string; file: string }>;
}
export type AvatarMap = Record<string, { kind: AvatarKind; file: string | null; photoVersion: string | null }>;

export async function getCatalogue(): Promise<AvatarCatalogue> {
  return (await apiClient.get<AvatarCatalogue>("/api/avatars/catalogue")).data;
}
export async function getAvatarMap(): Promise<AvatarMap> {
  return (await apiClient.get<AvatarMap>("/api/avatars/map")).data;
}
export async function chooseAvatar(input: { kind: AvatarKind; catalogueId?: string }): Promise<AvatarView> {
  return (await apiClient.put<AvatarView>("/api/avatars/me", input)).data;
}
export async function surpriseAvatar(idempotencyKey: string): Promise<AvatarView> {
  return (await apiClient.post<AvatarView>("/api/avatars/me/surprise", { idempotencyKey })).data;
}

export interface MyProfile {
  employeeId: string;
  name: string;
  employeeCode: string;
  role: string | null;
  department: string | null;
  grade: string | null;
  location: string | null;
  dateOfJoining: string;
  tenure: { years: number; months: number };
  reportsTo: { employeeId: string; employeeCode: string; name: string } | null;
  directReports: Array<{ employeeId: string; employeeCode: string; name: string; role: string | null }>;
  badges: Array<{ id: string; badge: string; givenAt: string; expiresAt: string | null; from?: string; message?: string | null }>;
  assets: Array<{ assetId: string; name: string; category: string; issuedAt: string }>;
  personal: { workEmail: string | null; phone: string | null; birthday: string | null };
  photoVersion: string | null;
  avatar: AvatarView;
}
export async function getMyProfile(): Promise<MyProfile> {
  return (await apiClient.get<MyProfile>("/api/profile/me")).data;
}
