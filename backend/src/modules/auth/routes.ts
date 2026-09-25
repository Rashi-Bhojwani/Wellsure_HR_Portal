import { Router } from "express";
import { authenticate, optionalAuthenticate } from "../../middleware/authenticate";
import { rateLimit } from "../../middleware/rateLimit";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import {
  acceptInvitationSchema,
  forgotPasswordSchema,
  invitationTokenParamsSchema,
  loginSchema,
  loginTotpSchema,
  resetPasswordParamsSchema,
  resetPasswordSchema,
  revokeSessionParamsSchema,
  totpDisableSchema,
  totpVerifySchema,
} from "./validators";

// Defaults used when the corresponding SystemSetting row hasn't been
// seeded/configured — see service.ts's getRequire2faRoles/getLockoutConfig
// for the equivalent pattern on non-rate-limit settings.
const LOGIN_RATE_LIMIT = { maxAttempts: 10, windowSeconds: 900 };
const FORGOT_PASSWORD_RATE_LIMIT = { maxAttempts: 5, windowSeconds: 3600 };
const INVITE_ACCEPT_RATE_LIMIT = { maxAttempts: 10, windowSeconds: 900 };
const RESET_PASSWORD_RATE_LIMIT = { maxAttempts: 10, windowSeconds: 900 };
const TOTP_VERIFY_RATE_LIMIT = { maxAttempts: 10, windowSeconds: 900 };

export const authRouter = Router();

authRouter.post("/login", rateLimit("auth.rateLimit.login", LOGIN_RATE_LIMIT), validate({ body: loginSchema }), controller.login);
authRouter.post(
  "/login/totp",
  rateLimit("auth.rateLimit.totpVerify", TOTP_VERIFY_RATE_LIMIT),
  validate({ body: loginTotpSchema }),
  controller.loginTotp,
);
authRouter.post("/refresh", controller.refresh);
authRouter.post("/logout", authenticate, controller.logout);
authRouter.post("/logout-all", authenticate, controller.logoutAll);
authRouter.get("/sessions", authenticate, controller.getSessions);
authRouter.delete("/sessions/:id", authenticate, validate({ params: revokeSessionParamsSchema }), controller.revokeSession);

authRouter.get("/invitations/:token", validate({ params: invitationTokenParamsSchema }), controller.getInvitation);
authRouter.post(
  "/invitations/:token/accept",
  rateLimit("auth.rateLimit.inviteAccept", INVITE_ACCEPT_RATE_LIMIT),
  validate({ params: invitationTokenParamsSchema, body: acceptInvitationSchema }),
  controller.acceptInvitation,
);

authRouter.post(
  "/forgot-password",
  rateLimit("auth.rateLimit.forgotPassword", FORGOT_PASSWORD_RATE_LIMIT),
  validate({ body: forgotPasswordSchema }),
  controller.forgotPassword,
);
authRouter.post(
  "/reset-password/:token",
  rateLimit("auth.rateLimit.resetPassword", RESET_PASSWORD_RATE_LIMIT),
  validate({ params: resetPasswordParamsSchema, body: resetPasswordSchema }),
  controller.resetPassword,
);

authRouter.get("/me", authenticate, controller.me);
authRouter.post("/privacy-notice/accept", authenticate, controller.acceptPrivacyNotice);

authRouter.post("/2fa/setup", optionalAuthenticate, controller.setupTotp);
authRouter.post(
  "/2fa/verify",
  optionalAuthenticate,
  rateLimit("auth.rateLimit.totpVerify", TOTP_VERIFY_RATE_LIMIT),
  validate({ body: totpVerifySchema }),
  controller.verifyTotp,
);
authRouter.post("/2fa/disable", authenticate, validate({ body: totpDisableSchema }), controller.disableTotp);
authRouter.post("/2fa/backup-codes/regenerate", authenticate, controller.regenerateBackupCodes);
