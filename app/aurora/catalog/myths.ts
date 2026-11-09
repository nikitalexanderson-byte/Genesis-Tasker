import RU from '../texts.ru.json';
import type { Channel, MythTransition, Predicate } from '../types';
import type { CuratorId } from '../registry';
type God = CuratorId | 'kronos';
type Row = [
    string,
    God,
    God,
    Channel,
    Channel,
    string,
    string,
    string,
    string,
    string,
    string,
    string
];
const sources = {
    M1: ['https://www.theoi.com/Text/HomericHymns2.html', RU.text0792, RU.text0793],
    M2: ['https://atlas.perseus.tufts.edu/library/passage/urn:cts:greekLit:tlg0013.tlg029.perseus-eng2:1-11/', RU.text0794, RU.text0795],
    M3: ['https://www-current.chs.harvard.edu/primary-source/homeric-hymn-to-demeter-sb/', RU.text0796, RU.text0797],
    M4: ['https://classics.mit.edu/Homer/iliad.21.xxi.html', RU.text0798, RU.text0799],
    M5: ['https://classics.mit.edu/Homer/odyssey.8.viii.html', RU.text0800, RU.text0801],
    M6: ['https://www-current.chs.harvard.edu/description-of-greece-a-pausanias-reader/', RU.text0802, RU.text0803],
    M7: ['https://www.theoi.com/Text/HesiodTheogony.html', RU.text0804, RU.text0805],
} as const;
// Predicates are explicit reported conditions. The myth never establishes them.
const rows: Row[] = [
    ['hermes-apollo', 'hermes', 'apollo', 'resource', 'resource', 'M1', 'multiple_versions', 'needs_one_form', 'validated_message_exists', RU.text0806, RU.text0807, RU.text0808],
    ['apollo-hermes', 'apollo', 'hermes', 'resource', 'resource', 'M1', 'rigid_version_blocks_exchange', 'terms_are_negotiable', 'single_form_is_mandatory', RU.text0809, RU.text0810, RU.text0811],
    ['hestia-hermes', 'hestia', 'hermes', 'resource', 'resource', 'M2', 'routine_is_closed', 'external_contact_needed', 'contact_is_unsafe', RU.text0812, RU.text0813, RU.text0814],
    ['hermes-hestia', 'hermes', 'hestia', 'tension', 'resource', 'M2', 'messages_fragment_attention', 'daily_result_defined', 'all_messages_are_urgent', RU.text0815, RU.text0816, RU.text0817],
    ['demeter-zeus', 'demeter', 'zeus', 'tension', 'resource', 'M3', 'essential_need_ignored', 'review_is_possible', 'need_is_already_met', RU.text0818, RU.text0819, RU.text0820],
    ['zeus-demeter', 'zeus', 'demeter', 'resource', 'tension', 'M3', 'plan_has_resource_gap', 'resource_gap_confirmed', 'resources_are_sufficient', RU.text0821, RU.text0822, RU.text0823],
    ['ares-athena', 'ares', 'athena', 'tension', 'resource', 'M4', 'pressure_has_failed', 'success_criterion_possible', 'immediate_danger', RU.text0824, RU.text0825, RU.text0826],
    ['athena-ares', 'athena', 'ares', 'resource', 'tension', 'M4', 'goal_shifted_to_winning', 'cost_is_disproportionate', 'original_goal_unchanged', RU.text0827, RU.text0828, RU.text0829],
    ['poseidon-apollo', 'poseidon', 'apollo', 'tension', 'resource', 'M4', 'past_hurt_shapes_current_dispute', 'current_fact_not_separated', 'ongoing_harm', RU.text0830, RU.text0831, RU.text0832],
    ['artemis-hera', 'artemis', 'hera', 'resource', 'resource', 'M4', 'autonomy_meets_shared_duty', 'consent_is_possible', 'boundary_contact_is_unsafe', RU.text0833, RU.text0834, RU.text0835],
    ['hera-artemis', 'hera', 'artemis', 'tension', 'resource', 'M4', 'shared_rule_intrudes', 'personal_boundary_confirmed', 'rule_is_nonnegotiable_safety', RU.text0836, RU.text0837, RU.text0838],
    ['aphrodite-hephaestus', 'aphrodite', 'hephaestus', 'resource', 'resource', 'M5', 'desire_touches_commitment', 'terms_can_be_revised', 'revision_causes_irreversible_harm', RU.text0839, RU.text0840, RU.text0841],
    ['hephaestus-poseidon', 'hephaestus', 'poseidon', 'tension', 'resource', 'M5', 'evidence_keeps_conflict_open', 'mediation_is_possible', 'mediator_not_trusted', RU.text0842, RU.text0843, RU.text0844],
    ['hephaestus-dionysus', 'hephaestus', 'dionysus', 'tension', 'resource', 'M6', 'control_excludes_contact', 'trusted_format_exists', 'contact_is_overwhelming', RU.text0845, RU.text0846, RU.text0847],
    ['dionysus-hephaestus', 'dionysus', 'hephaestus', 'resource', 'resource', 'M6', 'impulse_leaves_no_result', 'small_output_possible', 'recovery_needed_first', RU.text0848, RU.text0849, RU.text0850],
    ['hera-hephaestus', 'hera', 'hephaestus', 'tension', 'resource', 'M6', 'contribution_not_acknowledged', 'specific_contribution_known', 'contribution_is_only_assumed', RU.text0851, RU.text0852, RU.text0853],
    ['kronos-zeus', 'kronos', 'zeus', 'tension', 'resource', 'M7', 'preserved_order_blocks_renewal', 'responsibility_transfer_possible', 'transfer_forbidden_by_real_constraint', RU.text0854, RU.text0855, RU.text0856],
    ['zeus-kronos', 'zeus', 'kronos', 'resource', 'tension', 'M7', 'decisions_centralized_again', 'authority_can_be_limited', 'delegation_already_works', RU.text0857, RU.text0858, RU.text0859],
];
const yes = (field: string): Predicate => ({ field, operator: 'eq', value: true });
export const MYTH_TRANSITIONS: readonly MythTransition[] = rows.map(([id, sourceGodId, targetGodId, sourceChannel, targetChannel, source, first, second, disconfirm, projectInterpretation]) => {
    const [antiqueSource, sourcePassage, sourceSummary] = sources[source as keyof typeof sources];
    return { id, antiqueSource, sourcePassage, sourceSummary, projectInterpretation, sourceGodId, targetGodId, sourceChannel, targetChannel,
        activationPredicates: [yes(first), yes(second)], disconfirmingPredicates: [yes(disconfirm)], questionIds: [`myth-${id}-a`, `myth-${id}-b`, `myth-${id}-counter`], ruleVersion: 'myth-v1',
        participatesInMassFlow: sourceGodId !== 'kronos' && targetGodId !== 'kronos', temporalRoles: ['past', 'present', 'future'], tags: [sourceGodId, targetGodId, first, second] };
});
const counterQuestions: Record<string, string> = {
    validated_message_exists: RU.text0860,
    single_form_is_mandatory: RU.text0861,
    contact_is_unsafe: RU.text0862,
    all_messages_are_urgent: RU.text0863,
    need_is_already_met: RU.text0864,
    resources_are_sufficient: RU.text0865,
    immediate_danger: RU.text0866,
    original_goal_unchanged: RU.text0867,
    ongoing_harm: RU.text0868,
    boundary_contact_is_unsafe: RU.text0869,
    rule_is_nonnegotiable_safety: RU.text0870,
    revision_causes_irreversible_harm: RU.text0871,
    mediator_not_trusted: RU.text0872,
    contact_is_overwhelming: RU.text0873,
    recovery_needed_first: RU.text0874,
    contribution_is_only_assumed: RU.text0875,
    transfer_forbidden_by_real_constraint: RU.text0876,
    delegation_already_works: RU.text0877,
};
export const MYTH_QUESTION_SEEDS = rows.flatMap(([id, , , sourceChannel, , , , , disconfirm, , firstQuestion, secondQuestion]) => [
    { id: `myth-${id}-a`, field: MYTH_TRANSITIONS.find(e => e.id === id)!.activationPredicates[0].field, text: firstQuestion, channel: sourceChannel },
    { id: `myth-${id}-b`, field: MYTH_TRANSITIONS.find(e => e.id === id)!.activationPredicates[1].field, text: secondQuestion, channel: sourceChannel },
    { id: `myth-${id}-counter`, field: disconfirm, text: counterQuestions[disconfirm], channel: sourceChannel },
]);
