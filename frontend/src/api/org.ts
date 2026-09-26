import { apiClient } from "./client";

export interface City {
  id: string;
  name: string;
  state: string;
  _count?: { locations: number };
}
export interface Location {
  id: string;
  code: string;
  name: string;
  cityId: string | null;
  cityMaster?: City | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pincode: string;
  isActive: boolean;
  _count?: { jobHistory: number };
}
export interface SimpleMaster {
  id: string;
  code: string;
  name: string;
  rank?: number | null;
}

export async function listCities(): Promise<City[]> {
  const { data } = await apiClient.get<{ cities: City[] }>("/api/org/cities");
  return data.cities;
}
export async function createCity(input: { name: string; state: string }): Promise<City> {
  const { data } = await apiClient.post<City>("/api/org/cities", input);
  return data;
}
export async function updateCity(id: string, input: Partial<{ name: string; state: string }>): Promise<City> {
  const { data } = await apiClient.patch<City>(`/api/org/cities/${id}`, input);
  return data;
}
export async function deleteCity(id: string): Promise<void> {
  await apiClient.delete(`/api/org/cities/${id}`);
}

export async function listLocations(includeInactive = false): Promise<Location[]> {
  const { data } = await apiClient.get<{ locations: Location[] }>("/api/org/locations", { params: { includeInactive } });
  return data.locations;
}
export type LocationInput = {
  code: string;
  name: string;
  cityId?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  pincode: string;
};
export async function createLocation(input: LocationInput): Promise<Location> {
  const { data } = await apiClient.post<Location>("/api/org/locations", input);
  return data;
}
export async function updateLocation(id: string, input: Partial<LocationInput> & { isActive?: boolean }): Promise<Location> {
  const { data } = await apiClient.patch<Location>(`/api/org/locations/${id}`, input);
  return data;
}
export async function deleteLocation(id: string): Promise<void> {
  await apiClient.delete(`/api/org/locations/${id}`);
}
export async function mergeLocations(sourceId: string, intoLocationId: string): Promise<void> {
  await apiClient.post(`/api/org/locations/${sourceId}/merge`, { intoLocationId });
}

type SimpleResource = "departments" | "designations" | "grades" | "cost-centres";

async function listSimple(resource: SimpleResource): Promise<SimpleMaster[]> {
  const { data } = await apiClient.get<{ items: SimpleMaster[] }>(`/api/org/${resource}`);
  return data.items;
}
async function createSimple(resource: SimpleResource, input: { code: string; name: string; rank?: number }): Promise<SimpleMaster> {
  const { data } = await apiClient.post<SimpleMaster>(`/api/org/${resource}`, input);
  return data;
}
async function updateSimple(resource: SimpleResource, id: string, input: Partial<{ code: string; name: string; rank: number }>): Promise<SimpleMaster> {
  const { data } = await apiClient.patch<SimpleMaster>(`/api/org/${resource}/${id}`, input);
  return data;
}
async function deleteSimple(resource: SimpleResource, id: string): Promise<void> {
  await apiClient.delete(`/api/org/${resource}/${id}`);
}

export const departments = {
  list: () => listSimple("departments"),
  create: (input: { code: string; name: string }) => createSimple("departments", input),
  update: (id: string, input: Partial<{ code: string; name: string }>) => updateSimple("departments", id, input),
  remove: (id: string) => deleteSimple("departments", id),
};
export const designations = {
  list: () => listSimple("designations"),
  create: (input: { code: string; name: string }) => createSimple("designations", input),
  update: (id: string, input: Partial<{ code: string; name: string }>) => updateSimple("designations", id, input),
  remove: (id: string) => deleteSimple("designations", id),
};
export const grades = {
  list: () => listSimple("grades"),
  create: (input: { code: string; name: string; rank?: number }) => createSimple("grades", input),
  update: (id: string, input: Partial<{ code: string; name: string; rank: number }>) => updateSimple("grades", id, input),
  remove: (id: string) => deleteSimple("grades", id),
};
export const costCentres = {
  list: () => listSimple("cost-centres"),
  create: (input: { code: string; name: string }) => createSimple("cost-centres", input),
  update: (id: string, input: Partial<{ code: string; name: string }>) => updateSimple("cost-centres", id, input),
  remove: (id: string) => deleteSimple("cost-centres", id),
};
