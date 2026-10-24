import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "./theme/global.css";
import { App } from "./App";
import { initPwa } from "./lib/pwa";
import { applyThemeVars, readStoredPreference, resolveMode } from "./theme/ThemeProvider";

initPwa();
// index.html has already set data-theme and the page colours before the first paint; this fills in every --ws-* variable before React renders.
applyThemeVars(resolveMode(readStoredPreference()));

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
