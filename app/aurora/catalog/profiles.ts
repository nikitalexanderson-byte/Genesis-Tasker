import RU from '../texts.ru.json';
import type { CuratorId } from '../registry';
export const PROFILE_STATES = ['resource', 'excess', 'deficit', 'integration'] as const;
export type ProfileState = typeof PROFILE_STATES[number];
export type MeaningProfile = {
    id: string;
    curatorId: CuratorId;
    state: ProfileState;
    description: string;
    goalTags: string[];
    barrierTags: string[];
    confirmationQuestion: string;
    sourceRefs: string[];
    contentVersion: string;
};
const rows: [
    CuratorId,
    string[],
    string[],
    [
        string,
        string,
        string,
        string
    ]
][] = [
    ['zeus', ['measure', 'responsibility'], ['centralized_control', 'no_decision_owner'], [RU.text0878, RU.text0879, RU.text0880, RU.text0881]],
    ['hera', ['belonging', 'agreement'], ['one_sided_commitment', 'unclear_contribution'], [RU.text0882, RU.text0883, RU.text0884, RU.text0885]],
    ['poseidon', ['feeling', 'pause'], ['emotional_impulse', 'unnamed_feeling'], [RU.text0886, RU.text0887, RU.text0888, RU.text0889]],
    ['demeter', ['care', 'growth'], ['overcare', 'missing_support'], [RU.text0890, RU.text0891, RU.text0892, RU.text0893]],
    ['athena', ['clarity', 'strategy'], ['analysis_delay', 'unclear_criteria'], [RU.text0894, RU.text0895, RU.text0896, RU.text0897]],
    ['apollo', ['clarity', 'fact'], ['certainty_demand', 'fragmented_information'], [RU.text0898, RU.text0899, RU.text0900, RU.text0901]],
    ['artemis', ['boundary', 'protection'], ['premature_withdrawal', 'unspoken_boundary'], [RU.text0902, RU.text0903, RU.text0904, RU.text0905]],
    ['ares', ['initiative', 'action'], ['pressure', 'delayed_first_step'], [RU.text0906, RU.text0907, RU.text0908, RU.text0909]],
    ['aphrodite', ['reciprocity', 'desire'], ['unwanted_agreement', 'unspoken_desire'], [RU.text0019, RU.text0910, RU.text0911, RU.text0912]],
    ['hephaestus', ['craft', 'completion'], ['endless_improvement', 'no_prototype'], [RU.text0026, RU.text0913, RU.text0914, RU.text0915]],
    ['hermes', ['exchange', 'request'], ['words_without_agreement', 'missing_message'], [RU.text0916, RU.text0917, RU.text0918, RU.text0919]],
    ['hestia', ['rhythm', 'stability'], ['rigid_routine', 'no_anchor'], [RU.text0920, RU.text0921, RU.text0922, RU.text0923]],
    ['dionysus', ['expression', 'creativity'], ['unfinished_impulses', 'no_expression'], [RU.text0924, RU.text0925, RU.text0926, RU.text0927]],
];
export const MEANING_PROFILES: readonly MeaningProfile[] = rows.flatMap(([curatorId, goalTags, barrierTags, descriptions]) => PROFILE_STATES.map((state, index) => ({
    id: `${curatorId}-${state}`, curatorId, state, description: descriptions[index], goalTags,
    barrierTags: state === 'excess' ? [barrierTags[0]] : state === 'deficit' ? [barrierTags[1]] : barrierTags,
    confirmationQuestion: (RU.text0928 + descriptions[index].toLocaleLowerCase('ru') + RU.text0929),
    sourceRefs: ['project:13x4-v1', 'Jung:CW8', 'Jung:CW9I', 'SDT:RyanDeci2000'], contentVersion: 'aurora-content-v1',
})));
