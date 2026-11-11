import { apiClient } from "../../api/client";

// C-4B: offers, director-only pay, joining links/documents, conversion and referrals.
export type OfferState = "DRAFT" | "PROPOSED" | "APPROVED" | "ISSUED" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "WITHDRAWN";
export type OfferStatus = { offerManage: boolean; onboarding: boolean; isDirector: boolean; isApprover: boolean };
export type Offer = {
  id: string; applicationId: string; candidate: { id: string; name: string }; job: { id: string; title: string };
  title: string; department: { id: string; name: string } | null; location: { id: string; name: string } | null;
  reportingManager: { id: string; name: string } | null; employmentType: string; joiningDate: string; state: OfferState; version: number;
  approvalRequired: boolean | null; createdAt: string; convertedEmployeeId: string | null; canManage: boolean; isDirector: boolean;
  /** Directors only. */
  pay?: { recorded: boolean; version: number };
  events?: Array<{ version: number; kind: string; fromState: string | null; toState: string; reason: string | null; letterReference: string | null; createdAt: string }>;
};
export type PayValue = { amount: string; period: "ANNUAL" | "MONTHLY"; currency: "INR" };
export type Joining = {
  candidate: { id: string; name: string; live: boolean };
  offer: { id: string; joiningDate: string; title: string; convertedEmployeeId: string | null };
  required: Array<{ code: string; label: string; kind: string; uploaded: { id: string; uploadedAt: string; mimeType: string; sizeBytes: number } | null; exception: { approvedBy: string; createdAt: string; reason: string } | null }>;
  complete: boolean;
  links: Array<{ id: string; createdAt: string; expiresAt: string; revokedAt: string | null; completedAt: string | null; active: boolean }>;
  settings: { lifetimeSet: boolean; typesSet: boolean; approverSet: boolean };
  canManage: boolean; isApprover: boolean;
};
export type PublicJoining = { expiresAt: string; documents: Array<{ code: string; label: string; allowedMimeTypes: string[]; maxMb: number; uploaded: boolean }> };
export type Prefill = { offerId: string; convertedEmployeeId: string | null; fullName: string; email: string | null; phone: string | null };
export type MyReferral = { id: string; jobTitle: string; createdAt: string; status: "SUBMITTED" | "IN_REVIEW" | "CLOSED" };
export type Referral = { id: string; job: { id: string; title: string }; createdAt: string; name: string; email: string | null; phone: string | null };

const root = "/api/recruitment";
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);
export const offerStatus = () => data<OfferStatus>(apiClient.get(root + "/offer-status"));
export const offers = (query: { state?: OfferState; candidateId?: string } = {}) => data<{ items: Offer[] }>(apiClient.get(root + "/offers", { params: query }));
export const offer = (id: string) => data<Offer>(apiClient.get(`${root}/offers/${id}`));
export const createOffer = (input: { applicationId: string; title: string; departmentId: string; locationId: string; reportingManagerId: string | null; employmentType: string; joiningDate: string }) => data<Offer>(apiClient.post(root + "/offers", input));
export const moveOffer = (id: string, input: { to: OfferState; version: number; reason?: string; letterSentThroughLetters?: true; letterReference?: string }) => data<Offer>(apiClient.post(`${root}/offers/${id}/state`, input));
export const compensation = (id: string) => data<{ offerId: string; version: number; value: PayValue | null }>(apiClient.get(`${root}/offers/${id}/compensation`));
export const saveCompensation = (id: string, input: { amount: string; period: "ANNUAL" | "MONTHLY"; version: number }) => data<{ offerId: string; version: number; value: PayValue | null }>(apiClient.put(`${root}/offers/${id}/compensation`, input));
export const expectedPay = (candidateId: string) => data<{ candidateId: string; value: PayValue | null }>(apiClient.get(`${root}/candidates/${candidateId}/expected-pay`));
export const saveExpectedPay = (candidateId: string, value: { amount: string; period: "ANNUAL" | "MONTHLY" } | null) => data<{ candidateId: string; value: PayValue | null }>(apiClient.put(`${root}/candidates/${candidateId}/expected-pay`, { value }));
export const joining = (candidateId: string) => data<Joining>(apiClient.get(`${root}/candidates/${candidateId}/joining`));
export const createLink = (candidateId: string) => data<{ id: string; expiresAt: string; url: string; token: string }>(apiClient.post(`${root}/candidates/${candidateId}/joiner-links`, {}));
export const revokeLink = (id: string) => data<{ id: string; revoked: boolean }>(apiClient.post(`${root}/joiner-links/${id}/revoke`, {}));
export const grantException = (candidateId: string, typeCode: string, reason: string) => data<Joining>(apiClient.post(`${root}/candidates/${candidateId}/joining-exceptions`, { typeCode, reason }));
export const downloadJoiningDocument = (id: string) => apiClient.get<Blob>(`${root}/joining-documents/${id}/file`, { responseType: "blob" }).then((r) => r.data);
export const prefill = (offerId: string) => data<Prefill>(apiClient.get(`${root}/offers/${offerId}/conversion`));
export const convert = (offerId: string, input: Record<string, unknown>) => data<{ employeeId: string; employeeCode: string; created: boolean }>(apiClient.post(`${root}/offers/${offerId}/conversion`, input));
export const referralStatus = () => data<{ enabled: boolean; canReview: boolean }>(apiClient.get(root + "/referrals/status"));
export const referralJobs = () => data<Array<{ id: string; title: string }>>(apiClient.get(root + "/referrals/jobs"));
export const myReferrals = () => data<{ enabled: boolean; items: MyReferral[] }>(apiClient.get(root + "/referrals/mine"));
export const refer = (input: { jobId: string; name: string; email: string | null; phone: string | null; consentConfirmed: true }) => data<{ id: string; status: string }>(apiClient.post(root + "/referrals", input));
export const referrals = () => data<{ items: Referral[] }>(apiClient.get(root + "/referrals"));
export const acceptReferral = (id: string, source: string) => data<{ id: string; status: string; candidateId: string | null }>(apiClient.post(`${root}/referrals/${id}/accept`, { source }));
export const closeReferral = (id: string) => data<{ id: string; status: string }>(apiClient.post(`${root}/referrals/${id}/close`, {}));
