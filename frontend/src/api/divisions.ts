import { apiClient } from "./client";

// M session block 2, ER-27: divisions group departments (optional). An employee's division is their department's.
export interface Division {
  id: string;
  code: string;
  name: string;
  departments: Array<{ id: string; code: string; name: string }>;
}
export const listDivisions = async () => (await apiClient.get<{ divisions: Division[] }>("/api/divisions")).data.divisions;
export const createDivision = async (input: { code: string; name: string }) => (await apiClient.post<{ id: string }>("/api/divisions", input)).data;
export const updateDivision = async (id: string, input: { code: string; name: string }) => (await apiClient.patch(`/api/divisions/${id}`, input)).data;
export const deleteDivision = async (id: string) => void (await apiClient.delete(`/api/divisions/${id}`));
export const setDivisionDepartments = async (id: string, departmentIds: string[]) => (await apiClient.put(`/api/divisions/${id}/departments`, { departmentIds })).data;
/** The division a department belongs to, from the list. */
export const divisionOfDepartment = (divisions: Division[] | undefined, departmentId: string | null | undefined) => (departmentId ? divisions?.find((d) => d.departments.some((x) => x.id === departmentId)) ?? null : null);
