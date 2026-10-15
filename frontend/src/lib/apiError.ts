import type { AxiosError } from "axios";

interface ZodIssueLike {
  path: (string | number)[];
  message: string;
}
interface ApiErrorBody {
  error?: { message?: string; code?: string; issues?: ZodIssueLike[] };
}

// Every backend error response has the shape { error: { message, code,
// issues? } } (see backend/src/middleware/errorHandler.ts) — issues is
// only present for a Zod VALIDATION_ERROR, and its per-field messages are
// the actually useful part; the top-level message is just the generic
// "Validation failed". Surfacing only that generic string left every
// validation failure across the app (Add Employee, Organisation Setup,
// change requests, ...) looking like an opaque, unexplained error.
/**
 * The request never got an answer: the server is down or unreachable, the
 * network is, or the browser blocked the call (CORS, a bad address). There is
 * nothing wrong with the person's input or the data, and saying so sends people
 * checking the wrong thing (found when a login screen blamed the database for
 * an API that wasn't running).
 */
export function isConnectionFailure(err: unknown): boolean {
  const e = err as Partial<AxiosError> | null;
  return !!e && e.isAxiosError === true && !e.response;
}

export const CONNECTION_FAILURE_MESSAGE =
  "The server can't be reached. Check that the app's server is running and that you are online, then try again. (This is not a problem with your details or the data.)";

export function apiErrorMessage(err: unknown, fallback: string): string {
  if (isConnectionFailure(err)) return CONNECTION_FAILURE_MESSAGE;
  const axiosErr = err as AxiosError<ApiErrorBody>;
  const body = axiosErr.response?.data?.error;
  if (body?.issues?.length) {
    return body.issues
      .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
      .join(" · ");
  }
  if (body?.message) return body.message;
  const status = axiosErr.response?.status;
  if (status && status >= 500) return `The server hit a problem (error ${status}) and could not do that. Try again; if it keeps happening, tell whoever looks after this system.`;
  return fallback;
}

/** The machine-readable code of an API error (for example PAYROLL_CONSUMED), if the response carried one. */
export function apiErrorCode(err: unknown): string | undefined {
  return (err as AxiosError<ApiErrorBody>).response?.data?.error?.code;
}
