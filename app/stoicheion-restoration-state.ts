import { STOICHEION_NUMERALS } from "./stoicheion-numerals.ts";
import { SACRED_PRACTICES, type StoicheionPracticeSectorId } from "./sacred-practices.ts";
import { buildRestorationEquation, type AuxiliaryId, type RestorationNeed } from "./stoicheion-restoration-math.ts";

export const RESTORATION_POSITION_IDS = ["northwest", "north", "northeast", "west", "center", "east", "southwest", "south", "southeast"] as const;
export type RestorationDrawCard = { letterId: string; reversed: boolean };
export type RestorationSnapshot = {
  version: 1;
  cycleId: string;
  startedAt: string;
  startedDate: string;
  excludeStartDate?: boolean;
  sourceDate: string;
  sourceSeed: number;
  cards: RestorationDrawCard[];
  sectorId: StoicheionPracticeSectorId;
  letterId: string;
  need: RestorationNeed;
  supportIds: AuxiliaryId[];
  resourceLetterId: string;
  practiceId: string;
  spreadTotal: number;
  pythmen: number;
  intention: string;
  action: string;
  practiceText: string;
  reflection: string;
};

const letterById = new Map<string, typeof STOICHEION_NUMERALS[number]>(STOICHEION_NUMERALS.map(letter => [letter.id, letter]));
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value: unknown): value is string {
  return typeof value === "string" && datePattern.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
function boundedText(value: unknown, length: number) {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}

/** Invalid optional metadata must never make an existing habit unreadable. */
export function normalizeRestorationSnapshot(input: unknown): RestorationSnapshot | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<RestorationSnapshot>;
  if (value.version !== 1 || !validDate(value.sourceDate) || !validDate(value.startedDate)
    || !Number.isSafeInteger(value.sourceSeed) || value.sourceSeed! < 0 || value.sourceSeed! > 0xffffffff
    || typeof value.startedAt !== "string" || Number.isNaN(Date.parse(value.startedAt))
    || !RESTORATION_POSITION_IDS.includes(value.sectorId as typeof RESTORATION_POSITION_IDS[number])
    || !["deficit", "excess", "conflict"].includes(value.need ?? "")
    || !Array.isArray(value.cards) || value.cards.length !== 9
    || !Array.isArray(value.supportIds) || value.supportIds.length > 5) return null;
  const cards: RestorationDrawCard[] = [];
  for (const card of value.cards) {
    if (!card || !letterById.has(card.letterId) || typeof card.reversed !== "boolean") return null;
    cards.push({ letterId: card.letterId, reversed: card.reversed });
  }
  if (new Set(cards.map(card => card.letterId)).size !== 9) return null;
  const selected = cards[RESTORATION_POSITION_IDS.indexOf(value.sectorId as typeof RESTORATION_POSITION_IDS[number])];
  if (!selected.reversed || selected.letterId !== value.letterId) return null;
  const total = cards.reduce((sum, card) => sum + letterById.get(card.letterId)!.value, 0);
  let equation;
  try { equation = buildRestorationEquation(letterById.get(selected.letterId)!.value, total, value.supportIds); }
  catch { return null; }
  if (value.spreadTotal !== total || value.pythmen !== equation.target
    || !equation.candidates.some(letter => letter.id === value.resourceLetterId)
    || !SACRED_PRACTICES.some(practice => practice.id === value.practiceId)) return null;
  const cycleId = `${value.sourceDate}:${value.sourceSeed}:${value.sectorId}:${value.letterId}`;
  if (value.cycleId !== cycleId) return null;
  const intention = boundedText(value.intention, 500);
  const action = boundedText(value.action, 1600);
  const practiceText = boundedText(value.practiceText, 1600);
  if (!intention || !action || !practiceText) return null;
  return {
    version: 1, cycleId, startedAt: value.startedAt, startedDate: value.startedDate, sourceDate: value.sourceDate,
    ...(value.excludeStartDate === true ? { excludeStartDate: true } : {}),
    sourceSeed: value.sourceSeed!, cards, sectorId: value.sectorId!, letterId: selected.letterId,
    need: value.need!, supportIds: equation.supports.map(support => support.id),
    resourceLetterId: value.resourceLetterId!, practiceId: value.practiceId!,
    spreadTotal: total, pythmen: equation.target, intention, action, practiceText,
    reflection: boundedText(value.reflection, 2000),
  };
}

export function restorationCompletionDates(
  snapshot: RestorationSnapshot,
  habitId: string,
  completions: readonly {habitId: string; date: string; completed: boolean; updatedAt: string}[],
  today: string,
) {
  return [...new Set(completions.filter(entry => entry.habitId === habitId && entry.completed && validDate(entry.date)
    && entry.date >= snapshot.startedDate && entry.date <= today
    && !(snapshot.excludeStartDate === true && entry.date === snapshot.startedDate)
    && Date.parse(entry.updatedAt) >= Date.parse(snapshot.startedAt)).map(entry => entry.date))].sort().slice(0, 10);
}

export const RESTORATION_STAGES = [
  { count: 1, id: "foundation" },
  { count: 2, id: "discernment" },
  { count: 3, id: "exercise" },
  { count: 4, id: "integration" },
] as const;
