import type { SharedNotification, SharedOverview } from "./cloud-sync";

/** Every shared inbox entry contributes to the same total in both headers. */
export function sharedUnreadCount(overview: SharedOverview | null, notifications: SharedNotification[] = []): number {
  return overview
    ? overview.newTasks + overview.newProjects + overview.newComments + (overview.newNotifications ?? 0)
    : notifications.filter(item => !item.isRead).length;
}
