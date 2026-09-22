import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

// Base HTTP client for backend/. No real endpoints exist yet (Phase 1+),
// but the interceptor shape is ready for access/refresh tokens so modules
// can start calling real routes without touching this file.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return config;
});

let refreshing: Promise<void> | null = null;

async function refreshAccessToken(): Promise<void> {
  // Placeholder — real refresh-token rotation lands in Phase 1
  // (POST /api/auth/refresh, see docs/PROJECT_SPEC.md §3, §9).
  setAccessToken(null);
  return Promise.resolve();
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retried) {
      original._retried = true;
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null;
      });
      await refreshing;
      return apiClient(original);
    }

    return Promise.reject(error);
  },
);
