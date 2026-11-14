import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GenesisCalendar } from "../app/GenesisCalendar";
import { AppUrlCleaner } from "../app/AppUrlCleaner";
import { ButtonTooltips } from "../app/ButtonTooltips";
import { DialogDismissal } from "../app/DialogDismissal";
import { DialogHeaderActions } from "../app/DialogHeaderActions";
import { installWebBrandIcon } from "./web-brand-icon";
import "./visual-refinements.css";
import "../app/globals.css";
import "../app/dark-theme.css";
import "../app/tablet-layout.css";
import "../app/universal-ui.css";
import "../app/web-standart.css";
import "../app/experimental-theme.css";
import "../app/layout-refinements.css";
import "../app/popup-surfaces.css";
import "../app/dark-palettes.css";
import "../app/daylight-surfaces.css";
import "../app/green-classic-surfaces.css";
import "../app/lunar-hero-web.css";
import "./section-heading.css";
import "./habit-header.css";

const APP_BASE = (process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim() || "").replace(/\/$/, "");
document.documentElement.dataset.genesisWeb = "true";
installWebBrandIcon(APP_BASE);

function registerProductionServiceWorker() {
  const isLocalPreview = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (process.env.NODE_ENV !== "production" || isLocalPreview || !("serviceWorker" in navigator)) return;

  void navigator.serviceWorker.register(`${APP_BASE}/sw.js`, {
    scope: `${APP_BASE || ""}/`,
    updateViaCache: "none",
  }).then((registration) => registration.update());
}

registerProductionServiceWorker();

const root = document.getElementById("root");

if (!root) {
  throw new Error("GENESIS root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <AppUrlCleaner />
    <ButtonTooltips />
    <DialogDismissal />
    <DialogHeaderActions />
    <GenesisCalendar />
  </StrictMode>,
);
