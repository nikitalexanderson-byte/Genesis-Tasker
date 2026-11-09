import type { DiaryNote } from './diary-model';
import type { DiaryRecord } from './diary-storage';
import type { SleepEntry, SleepPlan } from './sleep-tracker';
import { isTrackerScheduledForDate } from './tracker-core';

export type DreamSettings = { todayMode: 'off' | 'morning' | 'all-day'; revision: number };
export const DEFAULT_DREAM_SETTINGS: DreamSettings = { todayMode: 'off', revision: 0 };
export function parseDreamSettings(value: unknown): DreamSettings {
  const row = value as DreamSettings;
  if (!row || !['off', 'morning', 'all-day'].includes(row.todayMode) || !Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error('DREAM_INVALID_SETTINGS');
  return { todayMode: row.todayMode, revision: row.revision };
}
/** The editor's latest draft represents a dream once in search and statistics. */
export function uniqueDreams(records: readonly DiaryRecord[]) {
  const byId = new Map<string, DiaryRecord>();
  for (const row of records) {
    if (!row.note.dream || row.note.archived) continue;
    const old = byId.get(row.note.id);
    if (!old || (row.draftKey && !old.draftKey) || Boolean(row.draftKey) === Boolean(old.draftKey) && row.note.updatedAt > old.note.updatedAt) byId.set(row.note.id, row);
  }
  return [...byId.values()].sort((a, b) => b.note.dream!.day.localeCompare(a.note.dream!.day) || b.note.updatedAt.localeCompare(a.note.updatedAt));
}
export function dreamMatches(note: DiaryNote, query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = `${note.title}\n${note.body}`.toLocaleLowerCase();
  return words.every(word => text.includes(word));
}
const addDay = (day: string, count: number) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
function parts(stamp: number, zone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(stamp).map(p => [p.type, p.value]));
}
function civilDay(stamp: number, zone: string) {
  const p = parts(stamp, zone); return `${p.year}-${p.month}-${p.day}`;
}
/** Reject a DST gap; for a repeated local minute choose its first occurrence on both clients. */
function localInstant(day: string, time: string, zone: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const desired = Date.parse(`${day}T${time}:00Z`);
  if (!Number.isFinite(desired)) return null;
  const offsets = new Set([-36, -12, 0, 12, 36].map(h => {
    const stamp = desired + h * 3600000, p = parts(stamp, zone);
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - stamp;
  }));
  const candidates = [...offsets].map(offset => desired - offset).filter(stamp => {
    const p = parts(stamp, zone); return `${p.year}-${p.month}-${p.day}` === day && `${p.hour}:${p.minute}` === time;
  });
  return candidates.length ? Math.min(...candidates) : null;
}
export function dreamMorningWindow(plans: readonly SleepPlan[], entries: readonly SleepEntry[], now: number): { visible: boolean; source: 'actual' | 'planned' | null } {
  const actual: number[] = [], planned: number[] = [];
  for (const plan of plans) {
    try {
      const zone = plan.schedule.timezone, today = civilDay(now, zone);
      for (const entry of entries.filter(e => e.planId === plan.id && e.wokeAt)) {
        const bed = entry.fellAsleepAt || plan.targetBedtime;
        const wakeDay = entry.wokeAt <= bed ? addDay(entry.date, 1) : entry.date;
        const stamp = localInstant(wakeDay, entry.wokeAt, zone);
        if (stamp !== null && (wakeDay === today || stamp <= now && now - stamp < 10800000)) actual.push(stamp);
      }
      if (!plan.active) continue;
      const sleepDay = plan.targetWakeTime <= plan.targetBedtime ? addDay(today, -1) : today;
      if (isTrackerScheduledForDate(plan.schedule, sleepDay, 'profane')) {
        const stamp = localInstant(today, plan.targetWakeTime, zone); if (stamp !== null) planned.push(stamp);
      }
    } catch { /* Invalid legacy timezone cannot invent a wake time. */ }
  }
  const candidates = actual.length ? actual : planned;
  const wake = candidates.length ? Math.max(...candidates) : null;
  return { visible: wake !== null && now >= wake && now < wake + 10800000, source: actual.length ? 'actual' : planned.length ? 'planned' : null };
}
