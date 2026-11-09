import {drawHarmony,unifiedSuitability} from './draw-harmony';
import { ACTIONS, type ActionRecord } from './catalog/actions';
import { cardInsight } from './card-insights';
import { DEITIES, SECTORS, type SectorId } from './registry';
import { eligibleSectors, validatePrimarySnapshot } from './spread';
import type { PrimaryDrawSnapshot, SituationProfile } from './types';

export type GoalOption = { id: string; title: string; description: string; value: string; goalTags: string[]; strategy: ActionRecord['strategy']; curatorId: ActionRecord['curatorId'] };
export const GOAL_CANDIDATE_COUNT = ACTIONS.length;
const words = (text: string) => new Set((text.toLocaleLowerCase('ru').match(/[а-яё]{5,}/gu) ?? []).map(word => word.slice(0, 6)));

/** Suggestions are choices, not evidence. Only the user's selection becomes the desired change. */
export function recommendGoalOptions(snapshot: PrimaryDrawSnapshot, sectorId: SectorId | null,
  situation: SituationProfile, limit = 5): GoalOption[] {
  validatePrimarySnapshot(snapshot);
  const harmony = drawHarmony(snapshot);
  const eligible = eligibleSectors(snapshot);
  if (eligible.length && (!sectorId || !eligible.includes(sectorId))) return [];
  const sector = SECTORS.find(item => item.id === sectorId);
  const card = snapshot.cards.find(item => item.sourcePositionId === sectorId);
  const insight = card ? cardInsight(card) : null;
  const symbolicWords = words(insight ? [insight.heading, ...insight.lines].join(' ') : '');
  const reportedWords = words([situation.topic, situation.originalQuestion, ...situation.facts, ...situation.constraints,
    ...Object.values(situation.fields).flatMap(field => field.status === 'known' && typeof field.value === 'string' ? [field.value] : [])].join(' '));
  const support = new Map<string, number>();
  for (const drawn of snapshot.cards) for (const share of drawn.functions ?? []) {
    support.set(share.deityId, (support.get(share.deityId) ?? 0) + share.share *
      (drawn.sourcePositionId === sectorId ? 4 : drawn.orientation === 'reversed' ? 1.5 : 1));
  }
  const ranked = ACTIONS.map(action => {
    const tokens = words(`${action.title} ${action.instructions[0]} ${action.observableCompletion}`);
    let score = (sector?.deities.includes(action.curatorId) ? 32 : 0) + (support.get(action.curatorId) ?? 0) * 3;
    score += action.profileState === 'integration' ? 5 : card?.orientation === 'reversed' && action.profileState === 'deficit' ? 3 : 0;
    for (const token of tokens) score += (symbolicWords.has(token) ? 2 : 0) + (reportedWords.has(token) ? 6 : 0);
    score += action.barrierTags.filter(tag => situation.barrierTypes.includes(tag)).length * 8;
    return { action, score: 100 * unifiedSuitability(score/(score+100),harmony,DEITIES[action.curatorId].sum) };
  });
  const chosen: typeof ranked = [];
  while (chosen.length < Math.min(Math.max(0, limit), ranked.length)) {
    const remaining = ranked.filter(item => !chosen.includes(item));
    remaining.sort((a, b) => {
      const adjusted = (item: typeof a) => item.score - chosen.filter(old => old.action.strategy === item.action.strategy).length * 6
        - chosen.filter(old => old.action.curatorId === item.action.curatorId).length * 4;
      return adjusted(b) - adjusted(a) || a.action.id.localeCompare(b.action.id, 'en');
    });
    chosen.push(remaining[0]);
  }
  return chosen.map(({ action }) => ({ id: action.id, title: action.title, description: action.instructions[0],
    value: `${action.title}: ${action.instructions[0]}`, goalTags: [...action.goalTags], strategy: action.strategy, curatorId: action.curatorId }));
}
