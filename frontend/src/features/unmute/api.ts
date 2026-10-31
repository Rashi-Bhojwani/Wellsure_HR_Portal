import { apiClient } from "../../api/client";

// Unmute API (backend/src/modules/unmute). Employees never receive a host's identity; hosts see their own bookers; directors see everything.

export type BookingStatus = "BOOKED" | "CANCELLED" | "RESCHEDULED" | "COMPLETED" | "NOT_HELD";
export interface PersonRef {
  employeeId: string;
  employeeCode: string;
  name: string;
}
export interface UnmuteStatus {
  active: boolean;
  canBook: boolean;
  missing: string[];
  officeName: string;
  isHost: boolean;
  isDirector: boolean;
}
export interface FreeSlot {
  id: string;
  startsAt: string;
  endsAt: string;
}
export interface MyBooking {
  id: string;
  host: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: BookingStatus;
  bookedAt: string;
  cancelledAt: string | null;
  cancelledBy: "BOOKER" | "HOST" | "SYSTEM" | null;
  rescheduledAt: string | null;
  completedAt: string | null;
}
export interface HostSlot {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "OPEN" | "WITHDRAWN";
  bookings: Array<{ id: string; booker: PersonRef; status: BookingStatus; timezone: string; bookedAt: string; cancelledBy: string | null; completedAt: string | null }>;
}
export interface AdminBooking {
  id: string;
  startsAt: string;
  endsAt: string;
  host: PersonRef;
  booker: PersonRef;
  timezone: string;
  status: BookingStatus;
  bookedAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
  rescheduledAt: string | null;
  completedAt: string | null;
}

const data = <T>(p: Promise<{ data: T }>): Promise<T> => p.then((r) => r.data);
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";

export const status = () => data<UnmuteStatus>(apiClient.get("/api/unmute/status"));
export const freeSlots = () => data<FreeSlot[]>(apiClient.get("/api/unmute/slots"));
export const myBookings = () => data<MyBooking[]>(apiClient.get("/api/unmute/bookings/mine"));
export const book = (slotId: string) => data<MyBooking>(apiClient.post("/api/unmute/bookings", { slotId, timezone: tz() }));
export const cancel = (id: string) => data<MyBooking>(apiClient.post(`/api/unmute/bookings/${id}/cancel`));
export const reschedule = (id: string, slotId: string) => data<MyBooking>(apiClient.post(`/api/unmute/bookings/${id}/reschedule`, { slotId }));

export const hostSlots = () => data<HostSlot[]>(apiClient.get("/api/unmute/host/slots"));
export const createSlot = (startsAt: string) => data<HostSlot>(apiClient.post("/api/unmute/host/slots", { startsAt }));
export const withdrawSlot = (id: string) => data<{ ok: true }>(apiClient.post(`/api/unmute/host/slots/${id}/withdraw`));
export const hostCancel = (id: string) => data<{ ok: true }>(apiClient.post(`/api/unmute/host/bookings/${id}/cancel`));
export const complete = (id: string, outcome: "COMPLETED" | "NOT_HELD") => data<{ ok: true }>(apiClient.post(`/api/unmute/host/bookings/${id}/complete`, { outcome }));

export const hosts = () => data<Array<PersonRef & { isHost: boolean }>>(apiClient.get("/api/unmute/admin/hosts"));
export const authoriseHost = (employeeId: string, reason: string) => data<unknown>(apiClient.post("/api/unmute/admin/hosts", { employeeId, reason }));
export const revokeHost = (employeeId: string, reason: string) => data<{ bookingsToHandle: number }>(apiClient.post(`/api/unmute/admin/hosts/${employeeId}/revoke`, { reason }));
export const allBookings = () => data<AdminBooking[]>(apiClient.get("/api/unmute/admin/bookings"));
export const affected = () => data<AdminBooking[]>(apiClient.get("/api/unmute/admin/affected"));
export const adminFreeSlots = () => data<Array<FreeSlot & { host: PersonRef }>>(apiClient.get("/api/unmute/admin/free-slots"));
export const reassign = (id: string, slotId: string) => data<{ id: string }>(apiClient.post(`/api/unmute/admin/bookings/${id}/reassign`, { slotId }));
export const adminCancel = (id: string) => data<{ ok: true }>(apiClient.post(`/api/unmute/admin/bookings/${id}/cancel`));
