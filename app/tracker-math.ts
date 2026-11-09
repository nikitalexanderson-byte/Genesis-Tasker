export type TrackerScoringMode = "none" | "binary" | "quality-ten" | "quality-bipolar";

export function scoreHabitFormula(mode: TrackerScoringMode, completed: boolean, qualityValue: number | null) {
  if (!completed || mode === "none") return 0;
  if (mode === "quality-ten") return Math.max(1, Math.min(10, Math.round(qualityValue ?? 5)));
  if (mode === "quality-bipolar") return Math.max(0, Math.min(20, 10 + 2 * Math.max(-5, Math.min(5, Math.round(qualityValue ?? 0)))));
  return 10;
}

function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function timeParts(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return { hour: Number.isFinite(hour) ? hour : 0, minute: Number.isFinite(minute) ? minute : 0 };
}

function addDateDays(value: string, days: number) {
  const { year, month, day } = dateParts(value);
  const result = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

export function trackerTimeMinutes(value: string) {
  const { hour, minute } = timeParts(value);
  return hour * 60 + minute;
}

function timeZoneOffset(timestamp: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - timestamp;
}

function zonedTimestamp(date: string, time: string, timeZone: string) {
  const { year, month, day } = dateParts(date);
  const { hour, minute } = timeParts(time);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desiredUtc;
  try {
    for (let iteration = 0; iteration < 4; iteration += 1) guess = desiredUtc - timeZoneOffset(guess, timeZone);
    return guess;
  } catch {
    return desiredUtc;
  }
}

export function calculateSleepDuration(date: string, fellAsleepAt: string, wokeAt: string, timeZone: string) {
  if (!fellAsleepAt || !wokeAt) return 0;
  const wakeDate = trackerTimeMinutes(wokeAt) <= trackerTimeMinutes(fellAsleepAt) ? addDateDays(date, 1) : date;
  const start = zonedTimestamp(date, fellAsleepAt, timeZone);
  const finish = zonedTimestamp(wakeDate, wokeAt, timeZone);
  return Math.max(0, Math.round((finish - start) / 60_000));
}

export type TrackerSleepRule = {
  field: "bedtime" | "wake";
  operator: "on-or-before" | "after";
  threshold: string;
  points: number;
};

export function scoreSleepRules(enabled: boolean, rules: TrackerSleepRule[], fellAsleepAt: string, wokeAt: string) {
  if (!enabled) return 0;
  return rules.reduce((score, rule) => {
    const value = rule.field === "bedtime" ? fellAsleepAt : wokeAt;
    if (!value) return score;
    const minutes = trackerTimeMinutes(value);
    const threshold = trackerTimeMinutes(rule.threshold);
    const matches = rule.operator === "on-or-before" ? minutes <= threshold : minutes > threshold;
    return matches ? score + rule.points : score;
  }, 0);
}

export function scoreAbstinenceDay(cleanDayPoints: number, relapsePenalty: number, cleanDay: boolean, relapse: boolean) {
  if (relapse) {
    const penalty = Math.max(0, Math.round(relapsePenalty));
    return penalty === 0 ? 0 : -penalty;
  }
  return cleanDay ? Math.max(0, Math.round(cleanDayPoints)) : 0;
}

function previousDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function currentAbstinenceStreak(entries: Array<{ trackerId: string; date: string; cleanDay: boolean; relapse: boolean }>, trackerId: string, today: string) {
  const byDate = new Map(entries.filter((entry) => entry.trackerId === trackerId).map((entry) => [entry.date, entry]));
  let cursor = today;
  let streak = 0;
  for (let scanned = 0; scanned < 20_000; scanned += 1) {
    const entry = byDate.get(cursor);
    if (!entry?.cleanDay || entry.relapse) break;
    streak += 1;
    cursor = previousDate(cursor);
  }
  return streak;
}

const MOOD_COLORS = ["#783d4b", "#67506d", "#526b87", "#8a6558", "#717b85", "#8a918d", "#679b95", "#557ca8", "#7f9555", "#d2965b", "#e2b64f", "#df775d"] as const;

export function moodValueColor(value: number) {
  return MOOD_COLORS[Math.max(0, Math.min(11, Math.round(value) + 5))];
}

export function nonNegativeTrackerTotal(groups: ReadonlyArray<ReadonlyArray<{ score: number }>>) {
  return Math.max(0, groups.reduce((total, group) => total + group.reduce((sum, entry) => sum + entry.score, 0), 0));
}
