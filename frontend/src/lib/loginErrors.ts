import type { AxiosError } from "axios";
import { apiErrorMessage, CONNECTION_FAILURE_MESSAGE, isConnectionFailure } from "./apiError";

/** Say what actually went wrong: an unreachable server is not a seeding problem (it cost someone half an hour). */
export function quickLoginFailure(employeeCode: string, err: unknown): string {
  if (isConnectionFailure(err)) return CONNECTION_FAILURE_MESSAGE;
  const status = (err as AxiosError).response?.status;
  const why = apiErrorMessage(err, "The server refused the sign-in.");
  // Only a refused sign-in can mean the account isn't there: that is the one case worth asking about the seed.
  return status === 401 || status === 403 ? `Could not log in as ${employeeCode}: ${why} If the database was just reset, has it been seeded?` : `Could not log in as ${employeeCode}: ${why}`;
}
