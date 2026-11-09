import { addCivilDays, isCivilDate } from "./calendar-context.ts";

export type HabitAutoDeletePolicy = {
  version: 1; id: string; count: number; unit: "days" | "weeks" | "months";
  points: "keep" | "remove"; startOn: string;
};
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Invalid configured rules must never silently turn into a destructive default. */
export function normalizeHabitAutoDelete(value: unknown): HabitAutoDeletePolicy | null {
  if (value == null) return null;
  const row = value as HabitAutoDeletePolicy;
  if (typeof value !== "object" || row.version !== 1 || !idPattern.test(row.id)
    || !Number.isInteger(row.count) || row.count < 1 || row.count > 365
    || !["days", "weeks", "months"].includes(row.unit) || !["keep", "remove"].includes(row.points)
    || !isCivilDate(row.startOn)) throw new RangeError("INVALID_HABIT_AUTO_DELETE");
  return { version: 1, id: row.id, count: row.count, unit: row.unit, points: row.points, startOn: row.startOn };
}

export function prepareHabitAutoDelete(value: HabitAutoDeletePolicy | null | undefined,
  previous: HabitAutoDeletePolicy | null | undefined, today: string) {
  const next = normalizeHabitAutoDelete(value), old = normalizeHabitAutoDelete(previous);
  if (!next) return null;
  if (old && old.count === next.count && old.unit === next.unit && old.points === next.points) return old;
  return { ...next, id: crypto.randomUUID(), startOn: today };
}

export function habitAutoDeleteDeadline(start: string, policy: Pick<HabitAutoDeletePolicy, "count" | "unit">) {
  if (policy.unit !== "months") return addCivilDays(start, policy.count * (policy.unit === "weeks" ? 7 : 1));
  const [year, month, day] = start.split("-").map(Number);
  const last = new Date(Date.UTC(year, month - 1 + policy.count + 1, 0));
  return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), Math.min(day, last.getUTCDate()))).toISOString().slice(0, 10);
}

/** Only closed days can expire a habit. Gaps in the schedule cannot start a missed period. */
export function habitAutoDeleteDue(policy: HabitAutoDeletePolicy, startDate: string, today: string,
  completions: readonly { date: string; completed: boolean }[],
  state: (day: string) => { status: string; conflict: boolean; unknown?: boolean }, scheduled: (day: string) => boolean) {
  let start = [policy.startOn, startDate].sort().at(-1)!;
  if (start >= today) return null;
  // A successful completion resets the entire consecutive period, including today's completion.
  const latest = completions.filter(row => row.completed && row.date >= start && row.date <= today).map(row => row.date).sort().at(-1);
  if (latest) start = addCivilDays(latest, 1);
  let firstMissed: string | null = null;
  for (let day = start, steps = 0; day < today; day = addCivilDays(day, 1), steps++) {
    if (steps >= 74_000) return null;
    const availability = state(day);
    if (availability.conflict || availability.unknown || availability.status !== "active") { firstMissed = null; continue; }
    if (!firstMissed && scheduled(day)) firstMissed = day;
  }
  if (!firstMissed) return null;
  const deadline = habitAutoDeleteDeadline(firstMissed, policy);
  return today >= deadline ? { firstMissed, deadline,
    id: `habit-auto-delete:${policy.id}:${firstMissed}:${deadline}:${policy.points}` } : null;
}

/** The ID preserves the decision through old readers and independent-device retries. */
export function habitAutomaticPoints(event: { id: string; action: string; automaticPoints?: "keep" | "remove" }) {
  if (event.action !== "delete") return undefined;
  return event.automaticPoints ?? (/^habit-auto-delete:[a-f0-9-]{36}:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}:(keep|remove)$/.exec(event.id)?.[1] as "keep" | "remove" | undefined);
}
