// These identifiers describe local state; they are never authentication credentials.
export const LOCAL_SIGN_OUT_KEY = "genesis-local-sign-out-v1";
const LOGIN_ID_KEY = "genesis-local-login-id-v1";
const PRIVATE_PREFIXES = [
  "genesis-backup-safety-v1:", "genesis-backup-held-v1:", "genesis-data-generation-v1:", "genesis-backup-history-v1:",
  "genesis-calendar-v2:", "genesis-workspace-device-key-v2:",
  "genesis-workspace-device-id-v1:", "genesis-workspace-sync-state-v1:",
  "genesis-pending-mutations-v2", "genesis-shared-offline-v1:", "genesis.shared-views.draft.", "genesis.shared-bulk.",
  "genesis.shared-push.",
  "genesis.advice-push.",
  "genesis.notification-panel.v1:",
  "genesis-shared-work-drafts-v1:",
  "genesis.habit-reminder.",
  "genesis-moon-reminders-v1:", "genesis-moon-reminders-sent-v1:",
  "genesis-stoicheion-draws-v2:", "genesis-shared-place-v1:", "genesis-affairs-area-v1:",
  "genesis-stoicheion-workspace-v1:",
  "genesis-aurora-workspace-v1:",
  "genesis-hidden-invitations:", "genesis-comment-notices:", "genesis-project-import:", "genesis-today-ad:",
];
const PRIVATE_KEYS = ["genesis-shared-editor-draft-signal-v1", "genesis-last-user-v2", "genesis-calendar-v1", "genesis-habit-notification-metrics-v1", "genesis-habit-notifications-delivered-v1", "genesis-solar-place-v1"];

export function markLocalSignOut(storage: Storage) {
  const loginId = storage.getItem(LOGIN_ID_KEY) || "";
  storage.setItem(LOCAL_SIGN_OUT_KEY, JSON.stringify({ loginId, confirmed: Boolean(loginId) }));
}

// Before explicit re-login, learn the old cookie ID without accepting its user.
export function prepareLocalSignIn(storage: Storage, currentLoginId: string) {
  if (hasLocalSignOut(storage)) storage.setItem(LOCAL_SIGN_OUT_KEY, JSON.stringify({ loginId: currentLoginId, confirmed: true }));
}

export function hasLocalSignOut(storage: Storage) {
  return storage.getItem(LOCAL_SIGN_OUT_KEY) !== null;
}

export function privateDeviceAccessBlocked() {
  if (typeof window === "undefined") return false;
  try { return hasLocalSignOut(window.localStorage); } catch { return true; }
}

export function acceptAuthenticatedLogin(storage: Storage, loginId: string) {
  const marker = storage.getItem(LOCAL_SIGN_OUT_KEY);
  if (marker !== null) {
    let oldId: unknown;
    try {
      const blocked = JSON.parse(marker) as { loginId?: unknown; confirmed?: boolean };
      if (!blocked.confirmed) return false;
      oldId = blocked.loginId;
    } catch { return false; }
    if (!loginId || loginId === oldId) return false;
    // Only a different server-issued login can reopen a locally signed-out device.
    storage.removeItem(LOCAL_SIGN_OUT_KEY);
  }
  if (loginId) storage.setItem(LOGIN_ID_KEY, loginId);
  return true;
}

export function clearPrivateDeviceStorage(storage: Storage) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (key && (PRIVATE_KEYS.includes(key) || PRIVATE_PREFIXES.some((prefix) => key.startsWith(prefix)))) {
      storage.removeItem(key);
    }
  }
  storage.removeItem(LOGIN_ID_KEY);
}
