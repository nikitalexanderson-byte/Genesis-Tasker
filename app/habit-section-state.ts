export const HABIT_SECTION_IDS = [
  "streak-resilience",
  "daily-trackers",
  "quests",
  "streak-rewards",
  "adaptive-suggestions",
  "regular-habits",
  "starter-habits",
  "sleep-abstinence",
  "achievements",
  "statistics",
  "sacred-habits",
] as const;

export type HabitSectionId = typeof HABIT_SECTION_IDS[number];

export const DEFAULT_HABIT_SECTION_ORDER: HabitSectionId[] = [...HABIT_SECTION_IDS];

export function isHabitSectionId(value: unknown): value is HabitSectionId {
  return typeof value === "string" && HABIT_SECTION_IDS.includes(value as HabitSectionId);
}

export function normalizeHabitCollapsedSections(value: unknown): HabitSectionId[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isHabitSectionId)));
}

export function normalizeHabitSectionOrder(value: unknown): HabitSectionId[] {
  const supplied = Array.isArray(value)
    ? Array.from(new Set(value.filter(isHabitSectionId)))
    : [];
  return [...supplied, ...DEFAULT_HABIT_SECTION_ORDER.filter((sectionId) => !supplied.includes(sectionId))];
}

export function moveHabitSection(
  value: unknown,
  sourceId: HabitSectionId,
  targetId: HabitSectionId,
): HabitSectionId[] {
  const order = normalizeHabitSectionOrder(value);
  const sourceIndex = order.indexOf(sourceId);
  const targetIndex = order.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return order;
  const next = [...order];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}
