import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

// Base HTTP client for backend/. Access tokens live in memory only (never
// localStorage — spec §9); the refresh token itself is an httpOnly cookie
// the browser attaches automatically (withCredentials below), never
// touched by JS. On a 401, one in-flight refresh is shared by every
// request that raced into it, then each original request is retried once.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

let accessToken: string | null = null;

// Set by AuthProvider so a failed silent refresh (session truly gone) can
// clear its user state too, not just this module's token — avoids a
// circular import between api/client.ts and hooks/useAuth.tsx.
let onRefreshFailed: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setOnRefreshFailed(handler: (() => void) | null): void {
  onRefreshFailed = handler;
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
  try {
    // Plain axios, not apiClient — must not carry a (possibly stale)
    // Authorization header, and must never itself trigger this same
    // interceptor on failure.
    const { data } = await axios.post<{ accessToken: string }>(
      `${API_BASE_URL}/api/auth/refresh`,
      undefined,
      { withCredentials: true },
    );
    setAccessToken(data.accessToken);
  } catch (err) {
    setAccessToken(null);
    onRefreshFailed?.();
    throw err;
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    // Never intercept the login/refresh endpoints themselves — a 401 from
    // /auth/login is just wrong credentials, not an expired session.
    const isAuthEndpoint = original?.url?.startsWith("/api/auth/login") || original?.url?.startsWith("/api/auth/refresh");

    if (error.response?.status === 401 && original && !original._retried && !isAuthEndpoint) {
      original._retried = true;
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null;
      });
      try {
        await refreshing;
      } catch {
        return Promise.reject(error);
      }
      return apiClient(original);
    }

    return Promise.reject(error);
  },
);
