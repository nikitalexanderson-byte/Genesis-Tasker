import type { SharedNotificationPreferences } from "./notification-settings-model";

/** A refresh carries only the user's changed fields onto the latest revision. */
export function rebaseNotificationPreferences(base: SharedNotificationPreferences, draft: SharedNotificationPreferences, latest: SharedNotificationPreferences): SharedNotificationPreferences {
  const merge = (before: unknown, own: unknown, remote: unknown): unknown => {
    if (JSON.stringify(before) === JSON.stringify(own)) return structuredClone(remote);
    const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
    if (!record(before) || !record(own) || !record(remote)) return structuredClone(own);
    const result = structuredClone(remote);
    for (const key of Object.keys(own)) result[key] = merge(before[key], own[key], remote[key]);
    return result;
  };
  return merge(base, draft, latest) as SharedNotificationPreferences;
}
