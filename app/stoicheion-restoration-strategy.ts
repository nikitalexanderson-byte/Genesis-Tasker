import { STOICHEION_NUMERALS } from "./stoicheion-numerals.ts";
import { AUXILIARY_WORDS, buildRestorationEquation, type AuxiliaryId, type RestorationNeed } from "./stoicheion-restoration-math.ts";
import { RESTORATION_POSITION_IDS, type RestorationDrawCard, type RestorationSnapshot } from "./stoicheion-restoration-state.ts";

export type RestorationSource = { sourceDate: string; sourceSeed: number; cards: RestorationDrawCard[] };
export type RestorationPlan = {
  need: RestorationNeed; supportIds: AuxiliaryId[]; resourceLetterId: string;
  intention: string; linkedHabitId: string; step: number; prepared: boolean; touched: boolean;
  withoutHabit?: boolean;
};
export type RestorationStrategy = RestorationSource & {
  version: 1; activeSectorId: string; plans: Record<string, RestorationPlan>;
};

export function restorationSourceKey(source: RestorationSource): string {
  return `${source.sourceDate}:${source.sourceSeed}:${source.cards.map(card => `${card.letterId}:${Number(card.reversed)}`).join(",")}`;
}
export function reversedSectors(source: RestorationSource): string[] {
  return source.cards.flatMap((card, index) => card.reversed ? [RESTORATION_POSITION_IDS[index]] : []);
}
export function restorationPlanEquation(source: RestorationSource, sectorId: string, plan: RestorationPlan) {
  const card = source.cards[RESTORATION_POSITION_IDS.indexOf(sectorId as typeof RESTORATION_POSITION_IDS[number])];
  const letter = STOICHEION_NUMERALS.find(item => item.id === card?.letterId);
  if (!letter || !card.reversed) throw new Error("RESTORATION_CARD_INVALID");
  const total = source.cards.reduce((sum, item) => sum + STOICHEION_NUMERALS.find(letter => letter.id === item.letterId)!.value, 0);
  return buildRestorationEquation(letter.value, total, plan.supportIds);
}
export function restorationPlanReady(source: RestorationSource, sectorId: string, plan: RestorationPlan): boolean {
  return Boolean(plan.prepared && plan.intention.trim() && restorationPlanEquation(source, sectorId, plan).candidates.some(item => item.id === plan.resourceLetterId));
}
export function snapshotMatchesSource(snapshot: RestorationSnapshot, source: RestorationSource): boolean {
  return restorationSourceKey(snapshot) === restorationSourceKey(source);
}

/** Reject corrupt or incompatible drafts instead of silently replacing a user's choices. */
export function validateRestorationStrategy(input: unknown): RestorationStrategy {
  if (!input || typeof input !== "object") throw new Error("RESTORATION_DRAFT_INVALID");
  const value = input as RestorationStrategy;
  if (value.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.sourceDate)
    || Number.isNaN(Date.parse(`${value.sourceDate}T12:00:00Z`))
    || new Date(`${value.sourceDate}T12:00:00Z`).toISOString().slice(0, 10) !== value.sourceDate
    || !Number.isSafeInteger(value.sourceSeed) || value.sourceSeed < 0 || value.sourceSeed > 0xffffffff
    || !Array.isArray(value.cards) || value.cards.length !== 9
    || value.cards.some(card => !card || typeof card.reversed !== "boolean" || !STOICHEION_NUMERALS.some(letter => letter.id === card.letterId))
    || new Set(value.cards.map(card => card.letterId)).size !== 9
    || !value.plans || typeof value.plans !== "object" || Array.isArray(value.plans)) throw new Error("RESTORATION_DRAFT_INVALID");
  const sectors = reversedSectors(value);
  if (!sectors.length || !sectors.includes(value.activeSectorId)
    || Object.keys(value.plans).length !== sectors.length) throw new Error("RESTORATION_DRAFT_INVALID");
  const plans: Record<string, RestorationPlan> = {};
  for (const id of sectors) {
    const plan = value.plans[id];
    if (!plan || !["deficit", "excess", "conflict"].includes(plan.need)
      || !Array.isArray(plan.supportIds) || plan.supportIds.length > 5 || new Set(plan.supportIds).size !== plan.supportIds.length
      || plan.supportIds.some(support => !Object.hasOwn(AUXILIARY_WORDS, support))
      || typeof plan.resourceLetterId !== "string" || typeof plan.intention !== "string" || plan.intention.length > 500
      || typeof plan.linkedHabitId !== "string" || plan.linkedHabitId.length > 200
      || plan.withoutHabit !== undefined && typeof plan.withoutHabit !== "boolean"
      || plan.withoutHabit === true && Boolean(plan.linkedHabitId)
      || !Number.isInteger(plan.step) || plan.step < 0 || plan.step > 3
      || typeof plan.prepared !== "boolean" || typeof plan.touched !== "boolean") throw new Error("RESTORATION_DRAFT_INVALID");
    const equation = restorationPlanEquation(value, id, plan);
    if (plan.resourceLetterId && !equation.candidates.some(item => item.id === plan.resourceLetterId)
      || plan.prepared && (!plan.resourceLetterId || !plan.intention.trim())) throw new Error("RESTORATION_DRAFT_INVALID");
    plans[id] = { ...plan, supportIds: [...plan.supportIds] };
  }
  return { version: 1, sourceDate: value.sourceDate, sourceSeed: value.sourceSeed,
    cards: value.cards.map(card => ({ letterId: card.letterId, reversed: card.reversed })), activeSectorId: value.activeSectorId, plans };
}

/** Existing habits (including copies) count by their full, immutable source. */
export function restorationPreparedCount(strategy: RestorationStrategy, snapshots: readonly RestorationSnapshot[]): number {
  return reversedSectors(strategy).filter(id => snapshots.some(snapshot => snapshot.sectorId === id && snapshotMatchesSource(snapshot, strategy))
    || restorationPlanReady(strategy, id, strategy.plans[id])).length;
}
