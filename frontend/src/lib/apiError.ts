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
export function apiErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<ApiErrorBody>;
  const body = axiosErr.response?.data?.error;
  if (body?.issues?.length) {
    return body.issues
      .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
      .join(" · ");
  }
  return body?.message ?? fallback;
}
