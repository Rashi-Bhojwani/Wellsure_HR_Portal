import { apiClient } from "./client";

// P7-5 (docs/plans/P7_5_REIMBURSEMENTS.md).
const base = "/api/reimbursements";
export interface ClaimView {
  id: string;
  employeeId: string;
  name?: string;
  typeKey: string;
  spentOn: string;
  amount: string;
  description: string;
  bills: string[];
  status: "SUBMITTED" | "APPROVED" | "PAID" | "REJECTED" | "WITHDRAWN";
  approvedAmount: string | null;
  reason: string | null;
  paidIn: string | null;
  createdAt: string;
}
export const myClaims = async () => (await apiClient.get<{ claims: ClaimView[]; claimable: Array<{ typeKey: string; name: string; billsRequired: boolean }> }>(`${base}/mine`)).data;
export async function makeClaim(body: { typeKey: string; spentOn: string; amount: string; description: string }, files: File[]): Promise<{ id: string }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.append(k, v);
  for (const f of files) form.append("files", f);
  return (await apiClient.post(`${base}/mine`, form)).data;
}
export const withdrawClaim = async (id: string) => (await apiClient.post(`${base}/mine/${id}/withdraw`)).data;
export const claimQueue = async (status: "SUBMITTED" | "ALL") => (await apiClient.get<{ claims: ClaimView[] }>(base, { params: { status } })).data.claims;
export const decideClaim = async (id: string, body: { decision: "APPROVE" | "REJECT"; amount?: string; reason?: string }) => (await apiClient.post(`${base}/${id}/decision`, body)).data;
