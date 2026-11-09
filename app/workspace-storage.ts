import { preserveHabitTimerRecords } from "./habit-timer-storage.ts";

type WorkspaceStorage = Pick<Storage, "getItem" | "setItem">;
const blocked = new WeakMap<WorkspaceStorage, Set<string>>();

/** Failed validation leaves the original bytes in place and blocks automatic writes. */
export function readProtectedWorkspace<T>(storage: WorkspaceStorage, key: string,
  normalize: (value: Record<string, unknown>) => T, empty: () => T): T {
  try {
    const saved = storage.getItem(key);
    if (saved === null) return empty();
    const parsed: unknown = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_WORKSPACE");
    const result = normalize(parsed as Record<string, unknown>);
    blocked.get(storage)?.delete(key);
    return result;
  } catch (cause) {
    const keys = blocked.get(storage) ?? new Set<string>();
    keys.add(key); blocked.set(storage, keys);
    throw new Error("LOCAL_WORKSPACE_RECOVERY_REQUIRED", { cause });
  }
}

export function assertWorkspaceWritable(storage: WorkspaceStorage, key: string) {
  if (blocked.get(storage)?.has(key)) throw new Error("LOCAL_WORKSPACE_RECOVERY_REQUIRED");
}

export function writeProtectedWorkspace(storage: WorkspaceStorage, key: string, value: unknown) {
  assertWorkspaceWritable(storage, key);
  const previous = storage.getItem(key);
  const next = previous === null ? value : preserveHabitTimerRecords(value, JSON.parse(previous));
  storage.setItem(key, JSON.stringify(next));
}
