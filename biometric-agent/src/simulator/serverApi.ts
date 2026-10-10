import type { ExpectedDay, Roster } from "@shared/attendance/simulator/model";

// The punch simulator's view of the server (docs/plans/PHASE_2.md "P2-G, commit
// G2 build design"): an ordinary HTTP client. It signs in as a person who may
// manage devices, reads the dev roster and the stored days, and (for setup)
// registers devices through the same screens' endpoints. It never touches the
// database.

export class ServerError extends Error {
  readonly name = "ServerError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown when the simulator refuses to run: nothing was sent. */
export class RefusedError extends Error {
  readonly name = "RefusedError";
}

export interface RosterResponse {
  appEnv: string;
  roster: Roster;
  skipped: Array<{ employeeCode: string; reason: string }>;
}

export type StoredDay = Record<keyof ExpectedDay, unknown>;

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/;

export class ServerApi {
  token: string | null = null;

  constructor(readonly baseUrl: string) {}

  get isLocal(): boolean {
    return LOCAL_HOST.test(new URL(this.baseUrl).hostname);
  }

  async request<T>(method: string, path: string, opts: { json?: unknown; form?: FormData; text?: string; headers?: Record<string, string>; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.auth !== false && this.token) headers.Authorization = `Bearer ${this.token}`;
    let body: string | FormData | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) body = opts.form;
    else if (opts.text !== undefined) {
      headers["Content-Type"] ??= "text/plain";
      body = opts.text;
    }
    const res = await fetch(new URL(path, this.baseUrl), { method, headers, body });
    const raw = await res.text();
    if (!res.ok) throw new ServerError(res.status, `${method} ${path} → ${res.status} ${raw.slice(0, 300)}`);
    const type = res.headers.get("content-type") ?? "";
    return (type.includes("json") && raw ? JSON.parse(raw) : raw) as T;
  }

  async login(employeeCode: string, password: string): Promise<void> {
    const r = await this.request<{ accessToken: string }>("POST", "/api/auth/login", { json: { employeeCode, password }, auth: false });
    this.token = r.accessToken;
  }

  roster(from: string, to: string, seed: number): Promise<RosterResponse> {
    return this.request("GET", `/api/dev/simulator/roster?from=${from}&to=${to}&seed=${seed}`);
  }

  async days(codes: string[], from: string, to: string): Promise<Record<string, StoredDay>> {
    const out: Record<string, StoredDay> = {};
    // The query string carries the codes: keep each request well inside a URL limit.
    for (let i = 0; i < codes.length; i += 150) {
      const r = await this.request<{ days: Record<string, StoredDay> }>("GET", `/api/dev/simulator/days?from=${from}&to=${to}&codes=${encodeURIComponent(codes.slice(i, i + 150).join(","))}`);
      Object.assign(out, r.days);
    }
    return out;
  }
}

/**
 * The simulator's refusal to run against a production server. Three things must
 * all hold before a single punch is sent: the address is this machine (unless
 * the person said otherwise), the server has the simulator endpoints (a
 * production build does not mount them), and it says it is not production.
 */
export async function assertDevelopmentServer(api: ServerApi, opts: { allowRemote: boolean; probeFrom: string; probeTo: string }): Promise<RosterResponse> {
  if (!api.isLocal && !opts.allowRemote) {
    throw new RefusedError(`${api.baseUrl} is not this machine. The simulator only runs against a local development server unless you pass --allow-remote (for a staging server). Nothing was sent.`);
  }
  let probe: RosterResponse;
  try {
    probe = await api.roster(opts.probeFrom, opts.probeTo, 1);
  } catch (err) {
    if (err instanceof ServerError && err.status === 404) {
      throw new RefusedError(`${api.baseUrl} has no simulator endpoints. That is what a production server looks like, so the simulator will not send anything to it.`);
    }
    throw err;
  }
  if (probe.appEnv === "production") throw new RefusedError(`${api.baseUrl} reports that it is a production server. Nothing was sent.`);
  return probe;
}
