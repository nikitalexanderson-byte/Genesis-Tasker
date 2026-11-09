import RU from '../texts.ru.json';
import { CURATOR_IDS, SECTORS, type CuratorId, type SectorId } from '../registry';
import type { Predicate } from '../types';
import { MEANING_PROFILES, PROFILE_STATES, type ProfileState } from './profiles';
import { ACTION_TEXTS } from './action-texts';
export const ACTION_STRATEGIES = ['clarify', 'change', 'support'] as const;
export type ActionStrategy = typeof ACTION_STRATEGIES[number];
export type ActionDuration = 2 | 10 | 30;
export type ActionRecord = {
    id: string;
    curatorId: CuratorId;
    profileState: ProfileState;
    sectorIds: SectorId[];
    strategy: ActionStrategy;
    mechanismId: string;
    situationTags: string[];
    goalTags: string[];
    barrierTags: string[];
    title: string;
    instructions: string[];
    durationVariants: {
        minutes: ActionDuration;
        instructions: string[];
        observableCompletion: string;
    }[];
    requiredResources: string[];
    preconditions: Predicate[];
    exclusions: Predicate[];
    observableCompletion: string;
    progressIndicator: string;
    ifThenTemplate: string;
    lowEffortAlternative: string;
    independentAlternative: string;
    mythologicalMotif: string;
    philosophicalInspiration: string;
    sourceRefs: string[];
    contentVersion: string;
};
// Requirements belong to concrete operations; a private draft needs only the
// note surface already present in this module. Unknown permission never grants it.
const REQUIREMENTS: Readonly<Record<string, string[]>> = {
    'hephaestus-resource-3': ['materials'], 'hephaestus-resource-4': ['materials'], 'hephaestus-resource-5': ['tools'],
    'hephaestus-deficit-3': ['materials'], 'hephaestus-deficit-4': ['tools'], 'hephaestus-deficit-5': ['materials'],
    'hephaestus-integration-3': ['materials', 'feedback'],
    'ares-deficit-4': ['tools'],
};
export const ACTIONS: readonly ActionRecord[] = CURATOR_IDS.flatMap(curatorId => PROFILE_STATES.flatMap(profileState => {
    const seeds = ACTION_TEXTS[`${curatorId}-${profileState}`], profile = MEANING_PROFILES.find(p => p.curatorId === curatorId && p.state === profileState)!;
    if (seeds.length !== 6)
        throw new Error('AURORA_ACTION_MODE_INCOMPLETE');
    return seeds.map((seed, index) => {
        const [title, task, observableCompletion] = seed.split('|');
        if (!observableCompletion)
            throw new Error('AURORA_ACTION_TEXT_INCOMPLETE');
        const mechanismId = `${curatorId}-${profileState}-${index + 1}`, strategy = ACTION_STRATEGIES[Math.floor(index / 2)];
        const independentAlternative = (RU.text0594 + title.toLocaleLowerCase('ru') + RU.text0595);
        return { id: `action-${mechanismId}`, curatorId, profileState, sectorIds: SECTORS.filter(s => s.deities.includes(curatorId)).map(s => s.id), strategy, mechanismId,
            situationTags: [strategy, ...profile.goalTags], goalTags: profile.goalTags, barrierTags: profile.barrierTags, title,
            instructions: [task, (RU.text0596 + observableCompletion)],
            durationVariants: [
                { minutes: 2 as const, instructions: [(RU.text0597 + task), RU.text0598], observableCompletion: RU.text0599 },
                { minutes: 10 as const, instructions: [task, (RU.text0600 + observableCompletion)], observableCompletion },
                { minutes: 30 as const, instructions: [task, (RU.text0601 + observableCompletion), RU.text0602], observableCompletion: ("" + observableCompletion + RU.text0603) },
            ], requiredResources: REQUIREMENTS[mechanismId] ?? ['private_note'], preconditions: [], exclusions: [{ field: 'immediate_danger', operator: 'eq' as const, value: true }],
            observableCompletion, progressIndicator: profile.description, ifThenTemplate: RU.text0604,
            lowEffortAlternative: RU.text0605, independentAlternative,
            mythologicalMotif: profile.description, philosophicalInspiration: RU.text0606,
            sourceRefs: ['Epictetus:Enchiridion:1', 'Aristotle:NicomacheanEthics:III.3', 'project:modern-practice-v1'], contentVersion: 'aurora-actions-v1' };
    });
}));
if (ACTIONS.length !== 312 || new Set(ACTIONS.map(a => a.title)).size !== 312)
    throw new Error('AURORA_ACTION_CATALOG_INCOMPLETE_OR_REPEATED');
