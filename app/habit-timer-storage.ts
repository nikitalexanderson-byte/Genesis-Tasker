import { habitTimerEpoch, habitWorkspaceEpoch, mergeHabitTimerOperations } from "./habit-timer.ts";
import { mergeHabitMeasurementEvents } from "./habit-measurement.ts";
import { normalizeRewardTransactions } from "./rewards.ts";
import type { Habit, HabitCompletion } from "./habits";
import { mergeHabitHistoryEdits } from "./habit-history.ts";
import { mergeHabitLifecycleEvents, projectHabitLifecycle } from "./habit-lifecycle.ts";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Ordinary stale form writes cannot erase an immutable timer or its already credited result. */
export function preserveHabitTimerRecords<T>(incoming: T, saved: unknown): T {
  if (!record(incoming) || !Array.isArray(incoming.habitTimers) || !record(saved)) return incoming;
  const epoch = habitTimerEpoch(incoming.habitTimerEpoch), previousEpoch = habitTimerEpoch(saved.habitTimerEpoch);
  if (epoch < previousEpoch) throw new RangeError("HABIT_TIMER_RESET");
  if (epoch > previousEpoch) return incoming;
  const habitTimers = mergeHabitTimerOperations(incoming.habitTimers, saved.habitTimers ?? []).filter(op => op.epoch === epoch);
  const habitHistory = mergeHabitHistoryEdits(incoming.habitHistory ?? [], saved.habitHistory ?? []).filter(row => row.epoch === epoch);
  const habits = new Map((Array.isArray(incoming.habits) ? incoming.habits : []).map(habit => [(habit as Habit).id, habit as Habit]));
  const lifecycleIds = new Set<string>();
  for (const habit of (Array.isArray(saved.habits) ? saved.habits : []) as Habit[]) {
    const current = habits.get(habit.id);
    const lifecycleHistory = mergeHabitLifecycleEvents(current?.lifecycleHistory, habit.lifecycleHistory);
    if (!lifecycleHistory.length) continue;
    lifecycleIds.add(habit.id);
    habits.set(habit.id, projectHabitLifecycle({ ...(current ?? habit), lifecycleHistory }));
  }
  for (const habit of habits.values()) if (habit.lifecycleHistory?.length) lifecycleIds.add(habit.id);
  if (!habitTimers.length && !habitHistory.length && !lifecycleIds.size) return incoming;
  const currentEvents = mergeHabitMeasurementEvents(incoming.habitMeasurements ?? []);
  const savedEvents = mergeHabitMeasurementEvents(saved.habitMeasurements ?? []);
  const habitIds = new Set(habits.keys());
  const timerEntries = new Set([...currentEvents, ...savedEvents].filter(event => event.source === "timer" && event.entryId.startsWith("timer-value:")).map(event => event.entryId));
  const historyDays = new Set(habitHistory.map(row => `${row.habitId}:${row.date}`));
  const retained = savedEvents.filter(event => habitIds.has(event.habitId) && (lifecycleIds.has(event.habitId) || timerEntries.has(event.entryId) || historyDays.has(`${event.habitId}:${event.date}`)));
  const habitMeasurements = mergeHabitMeasurementEvents(currentEvents, retained);
  const timedDays = new Set(habitMeasurements.filter(event => timerEntries.has(event.entryId)).map(event => `${event.habitId}:${event.date}`));
  historyDays.forEach(day => timedDays.add(day));
  const completions = new Map<string, HabitCompletion>();
  for (const row of (Array.isArray(incoming.habitCompletions) ? incoming.habitCompletions : []) as HabitCompletion[])
    completions.set(`${row.habitId}:${row.date}`, row);
  for (const row of (Array.isArray(saved.habitCompletions) ? saved.habitCompletions : []) as HabitCompletion[]) {
    const id = `${row.habitId}:${row.date}`;
    if (!habitIds.has(row.habitId) || !lifecycleIds.has(row.habitId) && !timedDays.has(id)) continue;
    const current = completions.get(id);
    completions.set(id, current ? { ...(lifecycleIds.has(row.habitId) && row.updatedAt > current.updatedAt ? row : current),
      xpAwarded: Math.max(current.xpAwarded, row.xpAwarded) } : row);
  }
  return { ...incoming, habits: [...habits.values()], habitTimers, habitHistory,
    habitTimerEpoch: habitWorkspaceEpoch(epoch, habitHistory.length > 0, lifecycleIds.size > 0 || habitHistory.some(row => row.source === "decision")
      || [...completions.values()].some(row => row.skippedAt)), habitMeasurements, habitCompletions: [...completions.values()],
    rewardTransactions: normalizeRewardTransactions([...(Array.isArray(incoming.rewardTransactions) ? incoming.rewardTransactions : []),
      ...(Array.isArray(saved.rewardTransactions) ? saved.rewardTransactions : [])]) } as T;
}

export function habitTimerDeviceOwner(storage: Pick<Storage, "getItem" | "setItem">) {
  const key = "genesis-habit-timer-device-v1";
  const saved = storage.getItem(key);
  if (saved) return saved;
  const owner = `web-${crypto.randomUUID()}`;
  storage.setItem(key, owner); return owner;
}

const lockDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  let blocked = false;
  const request = indexedDB.open("genesis-habit-timer-locks-v1", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("leases");
  request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
  request.onerror = () => reject(request.error);
  request.onblocked = () => { blocked = true; reject(new Error("HABIT_TIMER_BUSY")); };
});

async function fallbackLock<T>(scope: string, task: () => Promise<T>) {
  const db = await lockDatabase(), token = crypto.randomUUID();
  const changeLease = (release = false) => new Promise<boolean>((resolve, reject) => {
    const transaction = db.transaction("leases", "readwrite"); const store = transaction.objectStore("leases");
    let acquired = false;
    const get = store.get(scope);
    get.onsuccess = () => {
      const lease = get.result as { token: string; expiresAt: number } | undefined;
      if (release) { if (lease?.token === token) store.delete(scope); }
      else if (!lease || lease.expiresAt <= Date.now()) { store.put({ token, expiresAt: Date.now() + 120_000 }, scope); acquired = true; }
    };
    transaction.oncomplete = () => resolve(acquired);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("HABIT_TIMER_BUSY"));
  });
  try {
    if (!await changeLease()) throw new Error("HABIT_TIMER_BUSY");
    try { return await task(); } finally { await changeLease(true); }
  } finally { db.close(); }
}

/** HTTPS browsers use Web Locks; the fallback stores only a short-lived mutex, never habit content. */
export async function withHabitTimerLock<T>(scope: string, task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return await navigator.locks.request(`genesis-habit-timers:${scope}`, task);
  return fallbackLock(scope, task);
}
