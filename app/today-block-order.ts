export const TODAY_BLOCK_IDS = ["advice", "dream", "ads", "rhythm", "tasks", "habits", "events", "details"] as const;
export type TodayBlockId = (typeof TODAY_BLOCK_IDS)[number];

export function todayHalfBlocks(value: unknown): TodayBlockId[] {
  return Array.isArray(value) ? TODAY_BLOCK_IDS.filter(id => value.includes(id)) : [];
}

export function readTodayHalfBlocks(storage: Pick<Storage, 'getItem'> | null, owner: string): TodayBlockId[] {
  try { return todayHalfBlocks(JSON.parse(storage?.getItem(`genesis-today-halves:v1:${encodeURIComponent(owner || 'guest')}`) ?? 'null')); }
  catch { return []; }
}
export function storeTodayHalfBlocks(storage: Pick<Storage, 'setItem'> | null, owner: string, value: readonly TodayBlockId[]): boolean {
  if (!storage) return false;
  try { storage.setItem(`genesis-today-halves:v1:${encodeURIComponent(owner || 'guest')}`, JSON.stringify(todayHalfBlocks(value))); return true; }
  catch { return false; }
}

/** Missing blocks are appended, so stored preferences survive a future addition.
 * The fixed hero is never part of a movable order. */
export function todayBlockOrder(value: unknown): TodayBlockId[] | null {
  if (!Array.isArray(value) || !value.length || value.length > TODAY_BLOCK_IDS.length || new Set(value).size !== value.length
    || value.some(item => !TODAY_BLOCK_IDS.includes(item))) return null;
  return [...value, ...TODAY_BLOCK_IDS.filter(id => !value.includes(id))];
}

export function effectiveTodayBlockOrder(value: unknown): TodayBlockId[] {
  return todayBlockOrder(value) ?? [...TODAY_BLOCK_IDS];
}

export function moveTodayBlock(value: readonly TodayBlockId[], source: TodayBlockId, target: TodayBlockId): TodayBlockId[] {
  const next = effectiveTodayBlockOrder(value), from = next.indexOf(source), to = next.indexOf(target);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1); next.splice(to, 0, source); return next;
}

const storageKey = (owner: string) => `genesis-today-order:v1:${encodeURIComponent(owner || "guest")}`;
export function availableTodayBlockStorage(browser: Pick<Window, "localStorage"> | null): Storage | null {
  try { return browser?.localStorage ?? null; }
  catch { return null; }
}
export function readTodayBlockOrder(storage: Pick<Storage, "getItem"> | null, owner: string): TodayBlockId[] {
  try { return effectiveTodayBlockOrder(JSON.parse(storage?.getItem(storageKey(owner)) ?? "null")); }
  catch { return [...TODAY_BLOCK_IDS]; }
}
export function storeTodayBlockOrder(storage: Pick<Storage, "setItem"> | null, owner: string, value: readonly TodayBlockId[]): boolean {
  if (!storage) return false;
  try { storage.setItem(storageKey(owner), JSON.stringify(effectiveTodayBlockOrder(value))); return true; }
  catch { return false; }
}
