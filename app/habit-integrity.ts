import emojiCatalog from "./emoji-catalog.json" with { type: "json" };

export const HABIT_PRIORITY_MIN = 1;
export const HABIT_PRIORITY_MAX = 10;
export const DEFAULT_HABIT_PRIORITY = 5;
export const DEFAULT_HABIT_EMOJI = "✨";

export const HABIT_EMOJI_PRESETS = ["✨", "🎯", "💪", "🧠", "📚", "🧘", "🏃", "🌿", "💧", "🌙", "☀️", "🔥"] as const;

export const HABIT_EMOJI_CATEGORIES = emojiCatalog;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const HABIT_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function normalizeHabitPriority(value: unknown) {
  return Math.max(HABIT_PRIORITY_MIN, Math.min(HABIT_PRIORITY_MAX, Math.round(Number(value) || DEFAULT_HABIT_PRIORITY)));
}

export function normalizeHabitEmoji(value: unknown) {
  if (typeof value !== "string") return DEFAULT_HABIT_EMOJI;
  const trimmed = value.trim();
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  const normalized = segmenter ? (segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? "") : Array.from(trimmed).slice(0, 8).join("");
  return normalized && EMOJI_PATTERN.test(normalized) ? normalized : DEFAULT_HABIT_EMOJI;
}

export function normalizeHabitColor(value: unknown, fallback = "#bb8f4a") {
  return typeof value === "string" && HABIT_COLOR_PATTERN.test(value) ? value.toLowerCase() : fallback;
}

export function canRecordHabitOnDate(createdDate: string, date: string, today: string) {
  return DATE_PATTERN.test(createdDate) && DATE_PATTERN.test(date) && DATE_PATTERN.test(today)
    && date === today
    && date >= createdDate;
}
