import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { lazyPage } from "./lazyPage";

// Everything behind sign-in — RequireAuth, the two portal shells, the menu configs (and their icons) and every portal route — lives in PortalRoutes.tsx and loads
// with the first signed-in page, so the login screen never downloads any of it (bundle budget, DESIGN_SYSTEM.md §7).
const PortalRoutes = lazyPage(() => import("./PortalRoutes"), "PortalRoutes");

const LoginPage = lazyPage(() => import("../pages/auth/login/LoginPage"), "LoginPage");
const SetPasswordPage = lazyPage(
  () => import("../pages/auth/set-password/SetPasswordPage"),
  "SetPasswordPage",
);
const ForgotPasswordPage = lazyPage(
  () => import("../pages/auth/forgot-password/ForgotPasswordPage"),
  "ForgotPasswordPage",
);
const ResetPasswordPage = lazyPage(
  () => import("../pages/auth/reset-password/ResetPasswordPage"),
  "ResetPasswordPage",
);
const TotpChallengePage = lazyPage(
  () => import("../pages/auth/totp/TotpChallengePage"),
  "TotpChallengePage",
);
const TotpSetupPage = lazyPage(() => import("../pages/auth/totp/TotpSetupPage"), "TotpSetupPage");
// Development builds only: the screen index for reviewing the UI pass (docs/UI_SCREEN_MAP.md). Behind import.meta.env.DEV so production bundles never contain it.
const ScreensIndexPage = import.meta.env.DEV
  ? lazy(() =>
      import("../pages/dev/ScreensIndexPage").then((m) => ({ default: m.ScreensIndexPage })),
    )
  : null;

// Signed-out pages and the first paint of the shell wait on a blank page in the page colour (no spinner); inside the shell, AppShell shows a page-shaped skeleton.
export function AppRouter() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/set-password/:token" element={<SetPasswordPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="/totp-challenge" element={<TotpChallengePage />} />
        <Route path="/totp-setup" element={<TotpSetupPage />} />
        {ScreensIndexPage && <Route path="/dev/screens" element={<ScreensIndexPage />} />}

        <Route path="/app/*" element={<PortalRoutes />} />
        <Route path="/admin/*" element={<PortalRoutes />} />

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
