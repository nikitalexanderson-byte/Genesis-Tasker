import { normalizeTrackerEntity, trackerTimestamp, type TrackerEntity } from "./tracker-core";
import { moodValueColor } from "./tracker-math";

export type MoodValue = -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type MoodEntry = TrackerEntity & {
  date: string;
  recordedAt: string;
  moodValue: MoodValue;
  note: string;
  tags: string[];
  customLabel?: string;
  customEmoji?: string;
};

export const MOOD_SCALE = [
  { value: -5, label: "Крайне тяжело", labelEn: "Very difficult", symbol: "😣" },
  { value: -4, label: "Опустошённость", labelEn: "Drained", symbol: "😞" },
  { value: -3, label: "Грусть", labelEn: "Sad", symbol: "😢" },
  { value: -2, label: "Тревога", labelEn: "Anxious", symbol: "😰" },
  { value: -1, label: "Усталость", labelEn: "Tired", symbol: "😴" },
  { value: 0, label: "Нейтрально", labelEn: "Neutral", symbol: "😐" },
  { value: 1, label: "Спокойствие", labelEn: "Calm", symbol: "😌" },
  { value: 2, label: "Сосредоточенность", labelEn: "Focused", symbol: "🧐" },
  { value: 3, label: "Уверенность", labelEn: "Confident", symbol: "😎" },
  { value: 4, label: "Радость", labelEn: "Joyful", symbol: "😊" },
  { value: 5, label: "Воодушевление", labelEn: "Inspired", symbol: "🤩" },
  { value: 6, label: "Восторг", labelEn: "Delighted", symbol: "😄" },
] as const satisfies ReadonlyArray<{ value: MoodValue; label: string; labelEn: string; symbol: string }>;

const LEGACY_MOOD_VALUES: Record<string, MoodValue> = {
  overwhelmed: -5,
  empty: -4,
  angry: -3,
  irritated: -2,
  anxious: -2,
  sad: -3,
  tired: -1,
  neutral: 0,
  tender: 1,
  curious: 2,
  grateful: 3,
  confident: 3,
  focused: 2,
  calm: 1,
  joy: 4,
  radiant: 5,
  custom: 0,
};

export function moodColor(value: number) {
  return moodValueColor(value);
}

export function moodOption(value: number) {
  const normalized = Math.max(-5, Math.min(6, Math.round(value))) as MoodValue;
  return MOOD_SCALE.find((option) => option.value === normalized) ?? MOOD_SCALE[5];
}

export function normalizeMoodEntry(value: Record<string, unknown>, index = 0): MoodEntry | null {
  const date = typeof value.date === "string" ? value.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const rawMoodValue = typeof value.moodValue === "number"
    ? value.moodValue
    : LEGACY_MOOD_VALUES[String(value.moodId ?? "neutral")] ?? 0;
  const moodValue = Math.max(-5, Math.min(6, Math.round(rawMoodValue))) as MoodValue;
  const meta = normalizeTrackerEntity(value as Partial<TrackerEntity>, `mood-${date}-${index}`);
  const note = typeof value.note === "string"
    ? value.note
    : typeof value.custom === "string" ? value.custom : "";
  return {
    ...meta,
    date,
    recordedAt: typeof value.recordedAt === "string" && value.recordedAt
      ? value.recordedAt
      : typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : trackerTimestamp(),
    moodValue,
    note,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 20) : [],
    customLabel: typeof value.customLabel === "string" ? value.customLabel.trim().slice(0, 40) : "",
    customEmoji: typeof value.customEmoji === "string" ? value.customEmoji.trim().slice(0, 16) : "",
  };
}

export function normalizeMoodEntries(value: unknown): MoodEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = value
    .map((entry, index) => entry && typeof entry === "object" ? normalizeMoodEntry(entry as Record<string, unknown>, index) : null)
    .filter((entry): entry is MoodEntry => entry !== null);
  return Array.from(new Map(entries.map((entry) => [entry.id, entry])).values());
}
