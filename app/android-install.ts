type AndroidBrowser = {
  userAgent: string;
  platform?: string;
  userAgentData?: { mobile?: boolean; platform?: string };
};

/** The native app and embedded WebViews already have their own update flow. */
export function canOfferAndroidDownload(browser: AndroidBrowser) {
  if (/;\s*wv\b|\bGENESIS(?:Native|Android)\b/i.test(browser.userAgent)) return false;
  const platform = browser.userAgentData?.platform ?? browser.platform ?? "";
  const isAndroid = /android/i.test(`${platform} ${browser.userAgent}`);
  const isPhone = browser.userAgentData?.mobile ?? /mobile/i.test(browser.userAgent);
  return isAndroid && isPhone;
}

/** Show the published release, never a version that has not been uploaded yet. */
export function androidReleaseVersion(release: unknown): string | null {
  if (!release || typeof release !== "object" || !("versionName" in release)) return null;
  return typeof release.versionName === "string" && /^\d+\.\d+\.\d+$/.test(release.versionName)
    ? release.versionName : null;
}
