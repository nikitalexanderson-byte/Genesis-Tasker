import type { TrackerAnalyticsSnapshot } from "./tracker-analytics";
import { privateDeviceAccessBlocked } from "./local-sign-out";

const DB_NAME = "genesis-tracker-cache-v1";
const STORE_NAME = "analytics";
let writeGeneration = 0;

type CachedAnalytics = {
  cacheKey: string;
  snapshots: TrackerAnalyticsSnapshot[];
  updatedAt: string;
};

function openCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let expired = false;
    const timeout = globalThis.setTimeout(() => {
      expired = true;
      reject(new Error("IndexedDB did not respond"));
    }, 5000);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
    };
    request.onsuccess = () => {
      globalThis.clearTimeout(timeout);
      if (expired) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => {
      globalThis.clearTimeout(timeout);
      reject(request.error ?? new Error("IndexedDB is unavailable"));
    };
  });
}
export async function loadTrackerAnalyticsCache(cacheKey: string) {
  if (typeof indexedDB === "undefined" || privateDeviceAccessBlocked()) return [];
  try {
    const database = await openCache();
    const result = await new Promise<CachedAnalytics | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(cacheKey);
      request.onsuccess = () => resolve(request.result as CachedAnalytics | undefined);
      request.onerror = () => reject(request.error ?? new Error("Analytics cache could not be read"));
    });
    database.close();
    return !privateDeviceAccessBlocked() && Array.isArray(result?.snapshots) ? result.snapshots : [];
  } catch {
    return [];
  }
}

export async function saveTrackerAnalyticsCache(cacheKey: string, snapshots: TrackerAnalyticsSnapshot[]) {
  if (typeof indexedDB === "undefined" || privateDeviceAccessBlocked()) return;
  try {
    const generation = writeGeneration;
    const database = await openCache();
    if (generation !== writeGeneration || privateDeviceAccessBlocked()) { database.close(); return; }
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ cacheKey, snapshots, updatedAt: new Date().toISOString() } satisfies CachedAnalytics);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Analytics cache could not be written"));
    });
    database.close();
  } catch {
    // The encrypted workspace remains the source of truth when IndexedDB is unavailable.
  }
}

export async function clearAllTrackerAnalyticsCaches() {
  writeGeneration += 1;
  if (typeof indexedDB === "undefined") return;
  const database = await openCache();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Analytics cleanup failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Analytics cleanup aborted"));
    });
  } finally { database.close(); }
}

export async function clearTrackerAnalyticsCache(cacheKey: string) {
  if (typeof indexedDB === "undefined") return true;
  try {
    const database = await openCache();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(cacheKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Analytics cache could not be cleared"));
    });
    database.close();
    return true;
  } catch {
    return false;
  }
}
