import type { AdminUserStats } from "./cloud-sync";

export const ADMIN_USER_SORT_KEYS = ["user", "plan", "activity", "logins", "habits", "projects", "tasks", "google", "download", "version", "googleServices", "server"] as const;
export type AdminUserSortKey = typeof ADMIN_USER_SORT_KEYS[number];
export type AdminUserSort = { key: AdminUserSortKey; direction: "asc" | "desc" };
export const defaultAdminSortDirection = (key: AdminUserSortKey) => key === "user" || key === "plan" ? "asc" : "desc";

const timestamp = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
function syncRank(status: string | null, lastSync: string | null, now: number) {
  const date = timestamp(lastSync);
  if (status === "ok") return date === null ? 0 : now - date > 7 * 86400000 ? 2 : 4;
  return status === "warning" ? 3 : status === "disconnected" ? 1 : 0;
}
function values(user: AdminUserStats, key: AdminUserSortKey, now: number): (number | string | null)[] {
  switch (key) {
    case "user": return [user.email, user.displayName];
    case "plan": return [{free: 0, standart: 1, premium: 2, business: 3, premium4life: 4, elite_plus: 5}[user.subscriptionPlan ?? "free"]];
    case "activity": return [timestamp(user.lastSeenAt)];
    case "logins": return [user.loginCount];
    case "habits": return [user.metricsUpdatedAt ? user.habitCount : null];
    case "projects": return [user.metricsUpdatedAt ? user.projectCount : null];
    case "tasks": return [user.metricsUpdatedAt ? user.taskCount : null];
    case "google": return [Number(user.calendarConnected), user.googleSyncedCount];
    case "download": return [user.androidDownloadCount, timestamp(user.androidLastDownloadAt)];
    case "version": return [user.androidReportedVersion || user.androidVersions?.[0]?.version || null];
    case "googleServices": return [Number(user.googleAuthConnected), syncRank(user.androidGoogleSyncStatus, user.androidLastServerSyncAt, now)];
    case "server": return [syncRank(user.androidServerSyncStatus, user.androidLastServerSyncAt, now), timestamp(user.androidLastServerSyncAt)];
  }
}

/** Sort the entire result before mobile pagination. Missing reports always stay last. */
export function sortAdminUsers(users: readonly AdminUserStats[], sort: AdminUserSort | null, locale: string, now = Date.now()): AdminUserStats[] {
  if (!sort) return [...users];
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return [...users].sort((left, right) => {
    const a = values(left, sort.key, now), b = values(right, sort.key, now);
    for (let i = 0; i < a.length; i++) {
      if (a[i] === null || b[i] === null) {
        if (a[i] !== b[i]) return a[i] === null ? 1 : -1;
      } else {
        const result = typeof a[i] === "number" && typeof b[i] === "number" ? Number(a[i]) - Number(b[i]) : collator.compare(String(a[i]), String(b[i]));
        if (result) return (sort.direction === "asc" ? 1 : -1) * result;
      }
    }
    return collator.compare(left.email, right.email) || collator.compare(left.id, right.id);
  });
}
