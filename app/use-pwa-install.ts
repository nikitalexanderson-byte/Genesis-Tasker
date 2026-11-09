"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { canOfferAndroidDownload } from "./android-install";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const APP_BASE = (process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim() || "").replace(/\/$/, "");
const NATIVE_ANDROID_APK_URL = `${APP_BASE}/api/android/download`;

function isAndroidPhoneBrowser() {
  const isLocalAndroidPreview = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
    && new URLSearchParams(window.location.search).get("device") === "android-phone";
  if (isLocalAndroidPreview) return true;

  return canOfferAndroidDownload(navigator);
}

function isIosBrowser() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

const subscribeToBrowserCapabilities = () => () => {};
const getServerBrowserCapability = () => false;

export function usePwaInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const isAndroidPhone = useSyncExternalStore(
    subscribeToBrowserCapabilities,
    isAndroidPhoneBrowser,
    getServerBrowserCapability,
  );
  const isIos = useSyncExternalStore(subscribeToBrowserCapabilities, isIosBrowser, getServerBrowserCapability);
  const [isStandalone, setStandalone] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(display-mode: standalone)").matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
  );

  useEffect(() => {
    const isLocalPreview = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    if (process.env.NODE_ENV === "production" && !isLocalPreview && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register(`${APP_BASE}/sw.js`, {
        scope: `${APP_BASE || ""}/`,
        updateViaCache: "none",
      });
    }

    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const installed = () => {
      setPrompt(null);
      setStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  const install = async () => {
    if (!prompt) return false;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") setPrompt(null);
    return choice.outcome === "accepted";
  };

  return {
    nativeAndroidApkUrl: isAndroidPhone && !isStandalone ? NATIVE_ANDROID_APK_URL : null,
    canInstall: Boolean(prompt),
    install,
    isStandalone,
    isIos,
  };
}
