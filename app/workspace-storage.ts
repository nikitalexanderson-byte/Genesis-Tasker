import { preserveHabitTimerRecords } from "./habit-timer-storage.ts";
import {privateWorkspaceBridge} from './private-workspace-storage.ts';
import {assertLegacyLocalWriteAllowed} from './e2ee/web-local-migration-fence.ts';

type WorkspaceStorage = Pick<Storage, "getItem" | "setItem">;
const blocked = new WeakMap<WorkspaceStorage, Set<string>>();

/** Failed validation leaves the original bytes in place and blocks automatic writes. */
export function readProtectedWorkspace<T>(storage: WorkspaceStorage, key: string,
  normalize: (value: Record<string, unknown>) => T, empty: () => T): T {
  const privateBridge=privateWorkspaceBridge(key);
  if(privateBridge){const value=privateBridge.read();if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');return normalize(value as Record<string,unknown>);}
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
  if(key.startsWith('genesis-calendar-v2:'))assertLegacyLocalWriteAllowed(key.slice('genesis-calendar-v2:'.length),storage);
  if (blocked.get(storage)?.has(key)) throw new Error("LOCAL_WORKSPACE_RECOVERY_REQUIRED");
}

export function writeProtectedWorkspace(storage: WorkspaceStorage, key: string, value: unknown) {
  const privateBridge=privateWorkspaceBridge(key);
  if(privateBridge){const previous=privateBridge.read();return privateBridge.write(preserveHabitTimerRecords(value,previous));}
  assertWorkspaceWritable(storage, key);
  const previous = storage.getItem(key);
  const next = previous === null ? value : preserveHabitTimerRecords(value, JSON.parse(previous));
  storage.setItem(key, JSON.stringify(next));
}
