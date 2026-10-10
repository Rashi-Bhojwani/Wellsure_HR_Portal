import type { AgentHeartbeatRequest, AgentHeartbeatResponse, AgentPunchesRequest, AgentPunchesResponse } from "@shared/attendance/agentProtocol";
import { AGENT_VERSION } from "../version";

// The agent's side of the API (shared/attendance/agentProtocol.ts). HTTPS
// with the agent key as a Bearer token. Never throws for an HTTP status: the
// caller decides what a 401, 403 or 5xx means. A network failure is status null.

export interface ApiResult<T> {
  status: number | null;
  body: T | null;
  error: string | null;
  sentAt: number;
  receivedAt: number;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly agentKey: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post<T>(pathname: string, body: unknown): Promise<ApiResult<T>> {
    const sentAt = Date.now();
    try {
      const res = await this.fetchImpl(new URL(pathname, this.baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.agentKey}`, "User-Agent": `wellsure-agent/${AGENT_VERSION}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const receivedAt = Date.now();
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const message = (json as { error?: { message?: string } } | null)?.error?.message ?? null;
      return { status: res.status, body: res.ok ? (json as T) : null, error: res.ok ? null : `HTTP ${res.status}${message ? `: ${message}` : ""}`, sentAt, receivedAt };
    } catch (err) {
      return { status: null, body: null, error: (err as Error).name === "TimeoutError" ? `No answer from the API within ${Math.round(this.timeoutMs / 1000)} s.` : `Can't reach the API: ${(err as Error).message}`, sentAt, receivedAt: Date.now() };
    }
  }

  postPunches(body: AgentPunchesRequest): Promise<ApiResult<AgentPunchesResponse>> {
    return this.post("/api/biometric/agent/punches", body);
  }

  heartbeat(body: AgentHeartbeatRequest): Promise<ApiResult<AgentHeartbeatResponse>> {
    return this.post("/api/biometric/agent/heartbeat", body);
  }
}
