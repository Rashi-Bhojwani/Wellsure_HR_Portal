import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number");

export const loginSchema = z.object({
  employeeCode: z.string().min(1),
  password: z.string().min(1),
});

export const loginTotpSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(1),
});

export const refreshSchema = z.object({}); // refresh token comes from the cookie, not the body

export const logoutSchema = z.object({});

export const revokeSessionParamsSchema = z.object({ id: z.string().min(1) });

export const invitationTokenParamsSchema = z.object({ token: z.string().min(1) });

export const acceptInvitationSchema = z.object({ password: passwordSchema });

export const forgotPasswordSchema = z.object({ employeeCode: z.string().min(1) });

export const resetPasswordParamsSchema = z.object({ token: z.string().min(1) });

export const resetPasswordSchema = z.object({ password: passwordSchema });

export const totpVerifySchema = z.object({
  code: z.string().min(1),
  challengeToken: z.string().optional(), // present when completing the login-time setup/verify challenge
});

export const totpDisableSchema = z.object({
  password: z.string().min(1),
  code: z.string().min(1),
});
