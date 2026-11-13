import { apiClient } from "./client";

// M session block 2, ER-28: custom fields on the employee record.
export type FieldType = "TEXT" | "NUMBER" | "DATE" | "CHOICE";
export interface FieldDef { id: string; key: string; label: string; type: FieldType; options: string[]; visibleToEmployee: boolean; sensitive: boolean; active: boolean; position: number }
export interface FieldValue extends FieldDef { value: string | null; hasValue: boolean }
const base = "/api/custom-fields";
export const listDefinitions = async (includeInactive = false) => (await apiClient.get<{ fields: FieldDef[] }>(`${base}/definitions`, { params: includeInactive ? { includeInactive: "true" } : {} })).data.fields;
export const createDefinition = async (input: { key: string; label: string; type: FieldType; options: string[]; visibleToEmployee: boolean; sensitive: boolean }) => (await apiClient.post<{ id: string }>(`${base}/definitions`, input)).data;
export const updateDefinition = async (id: string, input: Partial<Pick<FieldDef, "label" | "options" | "visibleToEmployee" | "active" | "position">>) => (await apiClient.patch(`${base}/definitions/${id}`, input)).data;
export const valuesOf = async (employeeId: string) => (await apiClient.get<{ fields: FieldValue[] }>(`${base}/employees/${employeeId}`)).data.fields;
export const setValues = async (employeeId: string, values: Record<string, string | null>) => (await apiClient.put(`${base}/employees/${employeeId}`, { values })).data;
export const revealValue = async (employeeId: string, fieldId: string) => (await apiClient.post<{ value: string }>(`${base}/employees/${employeeId}/${fieldId}/reveal`)).data.value;
export const myFields = async () => (await apiClient.get<{ fields: Array<{ label: string; type: FieldType; value: string | null }> }>(`${base}/mine`)).data.fields;
export const TYPE_LABEL: Record<FieldType, string> = { TEXT: "Text", NUMBER: "Number", DATE: "Date", CHOICE: "A choice" };
