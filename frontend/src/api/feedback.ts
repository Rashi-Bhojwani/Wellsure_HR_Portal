import { apiClient } from "./client";

// M session block 2, SS-13: feedback to HR.
export type FeedbackCategory = "SUGGESTION" | "APPRECIATION" | "CONCERN" | "OTHER";
export const CATEGORY_LABEL: Record<FeedbackCategory, string> = { SUGGESTION: "Suggestion", APPRECIATION: "Appreciation", CONCERN: "Concern", OTHER: "Other" };
export interface Reply { message: string; at: string }
export interface MyFeedback { id: string; category: FeedbackCategory; message: string; status: "OPEN" | "CLOSED"; createdAt: string; replies: Reply[] }
export interface HrFeedback extends MyFeedback { from: { employeeCode: string; fullName: string } | null }
export const feedbackOptions = async () => (await apiClient.get<{ anonymousAllowed: boolean }>("/api/feedback/options")).data;
export const sendFeedback = async (input: { category: FeedbackCategory; message: string; anonymous: boolean }) => (await apiClient.post("/api/feedback", input)).data;
export const myFeedback = async () => (await apiClient.get<{ feedback: MyFeedback[] }>("/api/feedback/mine")).data.feedback;
export const listFeedback = async (status: "OPEN" | "CLOSED") => (await apiClient.get<{ feedback: HrFeedback[] }>("/api/feedback", { params: { status } })).data.feedback;
export const replyFeedback = async (id: string, message: string) => (await apiClient.post(`/api/feedback/${id}/replies`, { message })).data;
export const closeFeedback = async (id: string) => (await apiClient.post(`/api/feedback/${id}/close`)).data;
