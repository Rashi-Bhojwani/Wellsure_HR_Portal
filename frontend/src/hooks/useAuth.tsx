/* eslint-disable react-refresh/only-export-components -- context + hook are colocated by design */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setAccessToken, setOnRefreshFailed } from "../api/client";
import * as authApi from "../api/auth";
import type { LoginResponse, LoginTokensResponse, MeResponse } from "../api/auth";

interface AuthContextValue {
  user: MeResponse | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (employeeCode: string, password: string) => Promise<LoginResponse>;
  completeLoginWithTokens: (tokens: LoginTokensResponse) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasPermission: (key: string) => boolean;
  hasRole: (code: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setOnRefreshFailed(() => {
      setAccessToken(null);
      setUser(null);
    });

    // On first load there's no access token in memory (page refresh loses
    // it by design — spec §9 says never localStorage) — a silent refresh
    // against the httpOnly cookie is how a session survives a reload.
    authApi
      .refresh()
      .then(async ({ accessToken }) => {
        setAccessToken(accessToken);
        const profile = await authApi.me();
        if (!cancelled) setUser(profile);
      })
      .catch(() => {
        setAccessToken(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      setOnRefreshFailed(null);
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    async function completeLoginWithTokens(tokens: LoginTokensResponse): Promise<void> {
      setAccessToken(tokens.accessToken);
      const profile = await authApi.me();
      setUser(profile);
    }

    async function login(employeeCode: string, password: string): Promise<LoginResponse> {
      const result = await authApi.login(employeeCode, password);
      if (!authApi.isLoginChallenge(result)) {
        await completeLoginWithTokens(result);
      }
      return result;
    }

    async function logout(): Promise<void> {
      try {
        await authApi.logout();
      } finally {
        setAccessToken(null);
        setUser(null);
      }
    }

    async function refreshUser(): Promise<void> {
      const profile = await authApi.me();
      setUser(profile);
    }

    function hasPermission(key: string): boolean {
      return user?.permissions.includes(key) ?? false;
    }

    function hasRole(code: string): boolean {
      return user?.roleCodes.includes(code) ?? false;
    }

    return {
      user,
      isLoading,
      isAuthenticated: user !== null,
      login,
      completeLoginWithTokens,
      logout,
      refreshUser,
      hasPermission,
      hasRole,
    };
  }, [user, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
