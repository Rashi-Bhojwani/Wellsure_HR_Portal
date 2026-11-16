import { apiClient } from "./client";

// M session block 2, AD-08: further companies (legal entities) beside the main one.
export interface Entities { main: { name: string; activeEmployees: number }; entities: Array<{ id: string; code: string; name: string; registeredAddress: string | null; employees: number }> }
export const listEntities = async () => (await apiClient.get<Entities>("/api/legal-entities")).data;
export const createEntity = async (input: { code: string; name: string; registeredAddress?: string | null }) => (await apiClient.post("/api/legal-entities", input)).data;
export const assignEntity = async (employeeCodes: string[], legalEntityId: string | null) => (await apiClient.put<{ moved: number }>("/api/legal-entities/assignments", { employeeCodes, legalEntityId })).data;
