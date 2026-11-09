import RU from '../texts.ru.json';
import { SECTOR_IDS, type SectorId } from '../registry';
import type { EvidenceKind, Predicate } from '../types';
import { QUESTION_TEXT_ROWS } from './question-texts';
import { MYTH_QUESTION_SEEDS, MYTH_TRANSITIONS } from './myths';
export const INFORMATION_FAMILIES = ['event', 'sequence', 'repetition', 'grounds', 'meaning', 'capability', 'dependency', 'limits'] as const;
export type InformationFamily = typeof INFORMATION_FAMILIES[number];
export type AnswerChoice = {
    id: string;
    label: string;
    value: string | number | boolean;
    consequence: 'clarify' | 'verify' | 'act' | 'wait' | 'rescale' | 'independent' | 'reconsider' | 'observe';
};
export type QuestionRecord = {
    id: string;
    sectorTags: SectorId[];
    informationFamily: InformationFamily;
    text: string;
    applicableWhen: Predicate[];
    rulesOut: string[];
    resolvesFields: string[];
    answerSchema: {
        type: 'choice_with_detail';
        choices: AnswerChoice[];
        allowUnknown: true;
        allowSkip: true;
        allowNotApplicable: true;
        allowFreeDetail: true;
        detailRequiredWhen: string[];
    };
    nextBranchRules: {
        answerId: string;
        consequence: AnswerChoice['consequence'];
        clarifyFields: string[];
    }[];
    burden: number;
    evidenceRequirement: EvidenceKind;
    contentVersion: string;
    example: string;
    counterexample: string;
};
type Probe = {
    field: string;
    yes: string;
    no: string;
    whenYes: AnswerChoice['consequence'];
    whenNo: AnswerChoice['consequence'];
    kind: EvidenceKind;
    detail?: boolean;
};
const probe = (field: string, yes: string, no: string, whenYes: AnswerChoice['consequence'], whenNo: AnswerChoice['consequence'], kind: EvidenceKind = 'reported_event', detail = true): Probe => ({ field, yes, no, whenYes, whenNo, kind, detail });
// Six distinct decisions in each of eight information families.
export const QUESTION_PROBES: readonly Probe[][] = [
    [probe('event_observed', RU.text1002, RU.text1003, 'verify', 'clarify'),
        probe('target_observable', RU.text1004, RU.text1005, 'observe', 'clarify'),
        probe('change_desired', RU.text1006, RU.text1007, 'act', 'reconsider', 'value'),
        probe('baseline_defined', RU.text1008, RU.text1009, 'verify', 'clarify'),
        probe('actor_role_known', RU.text1010, RU.text1011, 'act', 'clarify'),
        probe('outcome_not_known', RU.text1012, RU.text1013, 'observe', 'reconsider')],
    [probe('event_order_known', RU.text1014, RU.text1015, 'verify', 'clarify'),
        probe('deadline_defined', RU.text1016, RU.text1017, 'wait', 'rescale', 'constraint'),
        probe('lead_time_known', RU.text1018, RU.text1019, 'wait', 'clarify'),
        probe('phase_known', RU.text1020, RU.text1021, 'act', 'clarify'),
        probe('condition_before_outcome', RU.text1022, RU.text1023, 'act', 'clarify', 'constraint'),
        probe('horizon_defined', RU.text1024, RU.text1025, 'observe', 'clarify', 'constraint')],
    [probe('repetition_known', RU.text1026, RU.text1027, 'verify', 'observe'),
        probe('pattern_same_context', RU.text1028, RU.text1029, 'verify', 'reconsider'),
        probe('prior_exception', RU.text1030, RU.text1031, 'reconsider', 'observe'),
        probe('attempted_again', RU.text1032, RU.text1033, 'reconsider', 'act'),
        probe('earlier_result_observed', RU.text1034, RU.text1035, 'verify', 'clarify'),
        probe('earliest_difference', RU.text1036, RU.text1037, 'act', 'clarify')],
    [probe('direct_evidence', RU.text1038, RU.text1039, 'verify', 'clarify'),
        probe('source_known', RU.text1040, RU.text1041, 'verify', 'clarify'),
        probe('explicit_agreement', RU.text1042, RU.text1043, 'act', 'clarify'),
        probe('inference_distinguished', RU.text1044, RU.text1045, 'verify', 'clarify'),
        probe('contrary_evidence', RU.text1046, RU.text1047, 'reconsider', 'observe'),
        probe('falsification_criterion', RU.text1048, RU.text1049, 'observe', 'clarify')],
    [probe('goal_is_own', RU.text1050, RU.text1051, 'act', 'reconsider', 'value'),
        probe('undesired_outcome_known', RU.text1052, RU.text1053, 'rescale', 'clarify', 'value'),
        probe('value_named', RU.text1054, RU.text1055, 'act', 'clarify', 'value'),
        probe('cost_acceptable', RU.text1056, RU.text1057, 'act', 'rescale', 'constraint'),
        probe('values_share_constraint', RU.text1058, RU.text1059, 'rescale', 'reconsider', 'value'),
        probe('goal_wanted_with_resources', RU.text1060, RU.text1061, 'act', 'reconsider', 'value')],
    [probe('available_time_known', RU.text1062, RU.text1063, 'rescale', 'wait', 'constraint'),
        probe('resource_available', RU.text1064, RU.text1065, 'act', 'rescale', 'constraint'),
        probe('skill_available', RU.text1066, RU.text1067, 'act', 'rescale', 'constraint'),
        probe('info_access', RU.text1068, RU.text1069, 'verify', 'independent', 'constraint'),
        probe('previous_attempt_effect', RU.text1070, RU.text1071, 'reconsider', 'observe'),
        probe('small_step_possible', RU.text1072, RU.text1073, 'act', 'rescale', 'constraint')],
    [probe('decision_owner_known', RU.text1074, RU.text1075, 'act', 'clarify'),
        probe('other_agreement', RU.text1076, RU.text1077, 'act', 'independent'),
        probe('external_dependency', RU.text1078, RU.text1079, 'wait', 'act', 'constraint'),
        probe('independent_alternative', RU.text1080, RU.text1081, 'independent', 'clarify'),
        probe('contact_safe', RU.text1082, RU.text1083, 'act', 'independent', 'constraint'),
        probe('waiting_deadline_known', RU.text1084, RU.text1085, 'wait', 'clarify', 'constraint')],
    [probe('nonnegotiable_constraint', RU.text1086, RU.text1087, 'rescale', 'verify', 'constraint'),
        probe('voluntary_commitment', RU.text1088, RU.text1089, 'reconsider', 'act', 'constraint'),
        probe('reversible_step', RU.text1090, RU.text1091, 'act', 'rescale', 'constraint'),
        probe('stop_condition_known', RU.text1092, RU.text1093, 'act', 'clarify', 'constraint'),
        probe('scale_limit_known', RU.text1094, RU.text1095, 'rescale', 'clarify', 'constraint'),
        probe('clear_scope', RU.text1096, RU.text1097, 'act', 'clarify', 'constraint')],
];
function choices(p: Probe): AnswerChoice[] { return [{ id: 'yes', label: p.yes, value: true, consequence: p.whenYes }, { id: 'no', label: p.no, value: false, consequence: p.whenNo }]; }
function record(id: string, sectorTags: SectorId[], informationFamily: InformationFamily, text: string, p: Probe, applicableWhen: Predicate[] = []): QuestionRecord {
    const answers = choices(p);
    return { id, sectorTags, informationFamily, text, applicableWhen, rulesOut: [`${p.field}:unexamined`], resolvesFields: [p.field],
        answerSchema: { type: 'choice_with_detail', choices: answers, allowUnknown: true, allowSkip: true, allowNotApplicable: true, allowFreeDetail: true, detailRequiredWhen: p.detail === false ? [] : ['yes'] },
        nextBranchRules: answers.map(a => ({ answerId: a.id, consequence: a.consequence, clarifyFields: a.consequence === 'clarify' ? [p.field] : [] })),
        burden: p.kind === 'value' ? 0.35 : 0.2, evidenceRequirement: p.kind, contentVersion: 'aurora-content-v1',
        example: (RU.text1098 + p.yes + RU.text1099 + p.whenYes + "."), counterexample: (RU.text1100 + p.no + RU.text1099 + p.whenNo + ".") };
}
export const BASE_QUESTIONS: readonly QuestionRecord[] = SECTOR_IDS.flatMap(sector => QUESTION_TEXT_ROWS[sector].flatMap((row, family) => {
    const cells = row.split('|');
    if (cells.length !== 6)
        throw new Error('AURORA_QUESTION_ROW_INCOMPLETE');
    return cells.map((text, index) => record(`${sector}-${INFORMATION_FAMILIES[family]}-${index + 1}`, [sector], INFORMATION_FAMILIES[family], text, QUESTION_PROBES[family][index]));
}));
export const MYTH_QUESTIONS: readonly QuestionRecord[] = MYTH_QUESTION_SEEDS.map(seed => {
    const edge = MYTH_TRANSITIONS.find(e => e.questionIds.includes(seed.id))!;
    const context: Predicate[] = edge.activationPredicates.filter(p => p.field !== seed.field);
    // The first condition is open; later checks are shown only after a relevant condition is reported.
    return record(seed.id, [], 'grounds', seed.text, probe(seed.field, RU.text1101, RU.text1102, 'verify', 'reconsider'), seed.id.endsWith('-a') ? [] : context);
});
export const QUESTIONS: readonly QuestionRecord[] = [...BASE_QUESTIONS, ...MYTH_QUESTIONS];
