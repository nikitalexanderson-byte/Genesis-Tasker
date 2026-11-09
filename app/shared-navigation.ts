import { privateDeviceAccessBlocked } from "./local-sign-out.ts";

export type SharedPlace = { spaceId: string; projectId: string; taskId: string; view: "list" | "board" | "calendar" | "gantt" | null; taskAction?: "locate" | "comments"; commentId?: string };
export const emptySharedPlace: SharedPlace = { spaceId: "", projectId: "", taskId: "", view: null };
const validId = (value: unknown): string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : "";
export function normalizeSharedPlace(value: unknown): SharedPlace {
  if (!value || typeof value !== "object") return { ...emptySharedPlace };
  const place = value as Partial<SharedPlace>;
  const spaceId = validId(place.spaceId), projectId = spaceId ? validId(place.projectId) : "";
  const taskId = projectId ? validId(place.taskId) : "";
  return { spaceId, projectId, taskId,
    ...(taskId && (place.taskAction === "locate" || place.taskAction === "comments") ? { taskAction: place.taskAction } : {}),
    ...(taskId && place.taskAction === "comments" && validId(place.commentId) ? { commentId: validId(place.commentId) } : {}),
    view: ["list", "board", "calendar", "gantt"].includes(place.view ?? "") ? place.view! : null };
}
export function sharedPlaceFromUrl(url: URL): SharedPlace | null {
  if (url.searchParams.get("affairs") !== "shared") return null;
  return normalizeSharedPlace({ spaceId: url.searchParams.get("space"), projectId: url.searchParams.get("project"),
    taskId: url.searchParams.get("task"), view: url.searchParams.get("projectView"), taskAction: url.searchParams.get("taskAction"), commentId: url.searchParams.get("comment") });
}
export function sharedPlaceUrl(url: URL, place: SharedPlace): URL {
  const result = new URL(url); result.searchParams.set("affairs", "shared"); result.hash = "projects";
  for (const [key, value] of [["space", place.spaceId], ["project", place.projectId], ["task", place.taskId], ["projectView", place.view], ["taskAction", place.taskAction], ["comment", place.commentId]]) {
    if (value) result.searchParams.set(key!, value); else result.searchParams.delete(key!);
  }
  return result;
}
export function savedSharedPlace(userId: string): SharedPlace {
  try { return normalizeSharedPlace(JSON.parse(localStorage.getItem(`genesis-shared-place-v1:${userId}`) || "null")); }
  catch { return { ...emptySharedPlace }; }
}
export function initialSharedPlace(userId: string): SharedPlace {
  return typeof window === "undefined" ? { ...emptySharedPlace } : sharedPlaceFromUrl(new URL(window.location.href)) ?? savedSharedPlace(userId);
}
export function saveSharedPlace(userId: string, place: SharedPlace) {
  if (privateDeviceAccessBlocked()) return;
  try { localStorage.setItem(`genesis-shared-place-v1:${userId}`, JSON.stringify(place)); } catch { /* URL history remains available. */ }
}
export function recordSharedPlace(userId: string, place: SharedPlace, replace = false) {
  if (privateDeviceAccessBlocked()) return;
  saveSharedPlace(userId, place);
  const url = sharedPlaceUrl(new URL(window.location.href), place);
  if (url.href === window.location.href) return;
  window.history[replace ? "replaceState" : "pushState"]({ ...window.history.state, genesisView: "projects" }, "", url.pathname + url.search + url.hash);
}
export function storedAffairsArea(userId: string): "personal" | "shared" {
  try { return localStorage.getItem(`genesis-affairs-area-v1:${userId}`) === "shared" ? "shared" : "personal"; } catch { return "personal"; }
}
export function saveAffairsArea(userId: string, area: "personal" | "shared") {
  if (privateDeviceAccessBlocked()) return;
  try { localStorage.setItem(`genesis-affairs-area-v1:${userId}`, area); } catch { /* The route also records the selection. */ }
}
