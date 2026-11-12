import { apiClient } from "./client";

// M session block 2, ER-18: policy acknowledgement.
export interface MyAck { id: string; title: string; acknowledgedAt: string | null }
export interface AckStatus { required: boolean; acknowledged: number; waiting: number; people: Array<{ employeeId: string; employeeCode: string; fullName: string; acknowledgedAt: string | null }> }
export const myAcks = async () => (await apiClient.get<{ documents: MyAck[] }>("/api/document-acks/mine")).data.documents;
export const acknowledge = async (id: string) => (await apiClient.post<{ acknowledgedAt: string }>(`/api/document-acks/${id}/acknowledge`)).data;
export const requiredDocuments = async () => (await apiClient.get<{ documentIds: string[] }>("/api/document-acks/required")).data.documentIds;
export const setRequired = async (id: string, required: boolean) => (await apiClient.put(`/api/document-acks/${id}/required`, { required })).data;
export const ackStatus = async (id: string) => (await apiClient.get<AckStatus>(`/api/document-acks/${id}/status`)).data;
