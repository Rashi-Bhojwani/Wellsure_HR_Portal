import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { quickLoginFailure } from "../loginErrors";
import { apiErrorMessage, CONNECTION_FAILURE_MESSAGE, isConnectionFailure } from "../apiError";

// A request that never got an answer is a connection problem, not a credentials
// or data problem; only a real refusal may blame the sign-in.
const networkError = () => new AxiosError("Network Error", "ERR_NETWORK");
const refused = (status: number, message?: string) =>
  new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, { status, statusText: "", headers: {}, config: { headers: new AxiosHeaders() }, data: message ? { error: { message } } : {} });

describe("honest error messages", () => {
  it("an unreachable server says so, whatever the fallback was", () => {
    expect(isConnectionFailure(networkError())).toBe(true);
    expect(apiErrorMessage(networkError(), "Could not cancel.")).toBe(CONNECTION_FAILURE_MESSAGE);
    expect(CONNECTION_FAILURE_MESSAGE).toMatch(/can't be reached/);
  });

  it("an answer from the server is not a connection failure, and its own words are used", () => {
    expect(isConnectionFailure(refused(401, "Invalid employee code or password."))).toBe(false);
    expect(apiErrorMessage(refused(401, "Invalid employee code or password."), "x")).toBe("Invalid employee code or password.");
    expect(apiErrorMessage(refused(500), "Could not save.")).toMatch(/server hit a problem \(error 500\)/);
    expect(apiErrorMessage(refused(404), "Could not save.")).toBe("Could not save.");
  });

  it("quick login: only a refused sign-in is allowed to ask about the seed; a dead server never is", () => {
    expect(quickLoginFailure("1000", networkError())).toBe(CONNECTION_FAILURE_MESSAGE);
    expect(quickLoginFailure("1000", networkError())).not.toMatch(/seed/i);
    expect(quickLoginFailure("1000", refused(401, "Invalid employee code or password."))).toMatch(/Could not log in as 1000: Invalid employee code or password\. If the database was just reset, has it been seeded\?/);
    expect(quickLoginFailure("1000", refused(500))).not.toMatch(/seed/i);
  });

  it("a plain JavaScript error is not mistaken for a connection failure", () => {
    expect(isConnectionFailure(new Error("boom"))).toBe(false);
    expect(apiErrorMessage(new Error("boom"), "Fallback.")).toBe("Fallback.");
  });
});
