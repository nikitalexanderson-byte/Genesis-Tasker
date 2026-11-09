import RU from '../texts.ru.json';
import { isopsephy, normalizeGreek, ORTHOGRAPHY_VERSION, GREEK_VOWELS } from '../greek';
import { CURATOR_IDS, DEITIES, SECTORS, type CuratorId, type SectorId } from '../registry';
export const LEXICON_VERSION = 'aurora-attested-lexicon-v1';
export type LexicalEntry = {
    id: string;
    kind: 'lexeme' | 'morpheme' | 'ritual_form' | 'deity_name';
    displayForm: string;
    canonicalForm: string;
    pronunciation: string;
    syllables: string[];
    stress: string | null;
    isopsephy: number;
    curatorIds: CuratorId[];
    sectorTags: SectorId[];
    goalTags: string[];
    valueTags: string[];
    barrierTags: string[];
    phoneticTags: string[];
    easeScore: number;
    dictionaryMeaning: string | null;
    intentionTemplates: string[];
    sourceRefs: string[];
    reviewed: boolean;
    orthographyVersion: string;
    contentVersion: string;
};
// Common ancient headwords; lexical meaning is kept distinct from project
// intention. Logeion links resolve the actual Greek headword in LSJ/related
// historical dictionaries. Russian syllables follow the existing project's
// conventional reading, not a claim to reconstruct ancient pitch or quantity.
const groups: readonly {
    tag: string;
    gods: CuratorId[];
    rows: readonly string[];
}[] = [
    { tag: 'clarity', gods: ['apollo', 'athena', 'hermes'], rows: [
            RU.text0607,
            RU.text0608,
            RU.text0609,
            RU.text0610,
            RU.text0611,
            RU.text0612,
            RU.text0613,
            RU.text0614,
            RU.text0615,
            RU.text0616,
            RU.text0617,
            RU.text0618,
            RU.text0619,
            RU.text0620,
            RU.text0621,
            RU.text0622,
        ] },
    { tag: 'measure', gods: ['zeus', 'hestia', 'athena'], rows: [
            RU.text0623,
            RU.text0624,
            RU.text0625,
            RU.text0626,
            RU.text0627,
            RU.text0628,
            RU.text0629,
            RU.text0630,
            RU.text0631,
            RU.text0632,
            RU.text0633,
            RU.text0634,
            RU.text0635,
            RU.text0636,
            RU.text0637,
            RU.text0638,
        ] },
    { tag: 'action', gods: ['ares', 'athena', 'hephaestus'], rows: [
            RU.text0639,
            RU.text0640,
            RU.text0641,
            RU.text0642,
            RU.text0643,
            RU.text0644,
            RU.text0645,
            RU.text0646,
            RU.text0647,
            RU.text0648,
            RU.text0649,
            RU.text0650,
            RU.text0651,
            RU.text0652,
            RU.text0653,
            RU.text0654,
        ] },
    { tag: 'boundary', gods: ['artemis', 'hera', 'zeus'], rows: [
            RU.text0655,
            RU.text0656,
            RU.text0657,
            RU.text0658,
            RU.text0659,
            RU.text0660,
            RU.text0661,
            RU.text0662,
            RU.text0663,
            RU.text0664,
            RU.text0665,
            RU.text0666,
            RU.text0667,
            RU.text0668,
            RU.text0669,
            RU.text0670,
        ] },
    { tag: 'reciprocity', gods: ['aphrodite', 'hera', 'hermes'], rows: [
            RU.text0671,
            RU.text0672,
            RU.text0673,
            RU.text0674,
            RU.text0675,
            RU.text0676,
            RU.text0677,
            RU.text0678,
            RU.text0679,
            RU.text0680,
            RU.text0681,
            RU.text0682,
            RU.text0683,
            RU.text0684,
            RU.text0685,
            RU.text0686,
        ] },
    { tag: 'care', gods: ['demeter', 'hestia', 'hera'], rows: [
            RU.text0687,
            RU.text0688,
            RU.text0689,
            RU.text0690,
            RU.text0691,
            RU.text0692,
            RU.text0693,
            RU.text0694,
            RU.text0695,
            RU.text0696,
            RU.text0697,
            RU.text0698,
            RU.text0699,
            RU.text0700,
            RU.text0701,
            RU.text0702,
        ] },
    { tag: 'craft', gods: ['hephaestus', 'apollo', 'athena'], rows: [
            RU.text0703,
            RU.text0704,
            RU.text0705,
            RU.text0706,
            RU.text0707,
            RU.text0708,
            RU.text0709,
            RU.text0710,
            RU.text0711,
            RU.text0712,
            RU.text0713,
            RU.text0714,
            RU.text0715,
            RU.text0716,
            RU.text0717,
            RU.text0718,
        ] },
    { tag: 'stability', gods: ['hestia', 'poseidon', 'demeter'], rows: [
            RU.text0719,
            RU.text0720,
            RU.text0721,
            RU.text0722,
            RU.text0723,
            RU.text0724,
            RU.text0725,
            RU.text0726,
            RU.text0727,
            RU.text0728,
            RU.text0729,
            RU.text0730,
            RU.text0731,
            RU.text0732,
            RU.text0733,
            RU.text0734,
        ] },
    { tag: 'creativity', gods: ['dionysus', 'aphrodite', 'poseidon'], rows: [
            RU.text0735,
            RU.text0736,
            RU.text0737,
            RU.text0738,
            RU.text0739,
            RU.text0740,
            RU.text0741,
            RU.text0742,
            RU.text0743,
            RU.text0744,
            RU.text0745,
            RU.text0746,
            RU.text0747,
            RU.text0748,
            RU.text0749,
            RU.text0750,
        ] },
];
export const LEXICON: readonly LexicalEntry[] = groups.flatMap(group => group.rows.map((row, index) => {
    const [displayForm, pronunciation, dictionaryMeaning] = row.split('|'), canonicalForm = normalizeGreek(displayForm, { archaic: false });
    return { id: `lex-${group.tag}-${index + 1}`, kind: 'lexeme' as const, displayForm, canonicalForm, pronunciation, syllables: pronunciation.split('-'),
        stress: null, isopsephy: isopsephy(displayForm), curatorIds: group.gods, sectorTags: SECTORS.filter(s => s.deities.some(d => group.gods.includes(d as CuratorId))).map(s => s.id),
        goalTags: [group.tag], valueTags: [group.tag], barrierTags: [], phoneticTags: [group.tag], easeScore: canonicalForm.length <= 7 ? 0.95 : 0.8,
        dictionaryMeaning, intentionTemplates: [(RU.text0751 + dictionaryMeaning + ".")],
        sourceRefs: [`https://www.logeion.org/${encodeURIComponent(displayForm)}`], reviewed: true, orthographyVersion: ORTHOGRAPHY_VERSION, contentVersion: LEXICON_VERSION };
}));
const namePronunciations: Record<CuratorId, string> = { zeus: RU.text0752, hera: RU.text0753, poseidon: RU.text0754, demeter: RU.text0755, athena: RU.text0756, apollo: RU.text0757, artemis: RU.text0758, ares: RU.text0759, aphrodite: RU.text0760, hephaestus: RU.text0761, hermes: RU.text0762, hestia: RU.text0763, dionysus: RU.text0764 };
export const FALLBACK_NAMES: readonly LexicalEntry[] = CURATOR_IDS.map(id => ({ id: `name-${id}`, kind: 'deity_name', displayForm: DEITIES[id].greekDisplayName, canonicalForm: DEITIES[id].canonicalForm,
    pronunciation: namePronunciations[id], syllables: namePronunciations[id].split('-'), stress: null, isopsephy: DEITIES[id].sum, curatorIds: [id], sectorTags: SECTORS.filter(s => s.deities.includes(id)).map(s => s.id),
    goalTags: [], valueTags: [], barrierTags: [], phoneticTags: [], easeScore: 0.8, dictionaryMeaning: null, intentionTemplates: [], sourceRefs: [DEITIES[id].sourceUrl], reviewed: true, orthographyVersion: ORTHOGRAPHY_VERSION, contentVersion: LEXICON_VERSION }));
/** Prepared, explicitly CONSTRUCTED forms: no dictionary translation claimed. */
const ritualRows: readonly [
    CuratorId,
    string,
    string,
    string
][] = [
    ['athena', 'ΚΙΘΙΚ', RU.text0765, 'clarity'], ['athena', 'ΚΑΜΗ', RU.text0766, 'strategy'],
    ['hera', 'ΜΙΘΙΜ', RU.text0767, 'agreement'], ['hera', 'ΝΕΛΙΔΙ', RU.text0768, 'belonging'],
    ['zeus', 'ΣΕΡΑΑΡΕΣ', RU.text0769, 'measure'], ['zeus', 'ΧΕΒΕ', RU.text0770, 'responsibility'],
    ['poseidon', 'ΒΕΓΥΘΩ', RU.text0771, 'feeling'], ['poseidon', 'ΒΑΖΥΘΩ', RU.text0772, 'pause'],
    ['demeter', 'ΚΗΜΥ', RU.text0773, 'care'], ['demeter', 'ΜΗΚΥ', RU.text0774, 'growth'],
    ['apollo', 'ΒΑΝΗΣΩ', RU.text0775, 'clarity'], ['apollo', 'ΒΑΣΗΝΩ', RU.text0776, 'fact'],
    ['artemis', 'ΧΕΝΑ', RU.text0777, 'boundary'], ['artemis', 'ΧΗΜΗ', RU.text0778, 'protection'],
    ['ares', 'ΓΕΤΑ', RU.text0779, 'action'], ['ares', 'ΣΑΡΗ', RU.text0780, 'initiative'],
    ['aphrodite', 'ΒΑΚΟΡΩ', RU.text0781, 'reciprocity'], ['aphrodite', 'ΒΑΜΟΠΩ', RU.text0782, 'desire'],
    ['hephaestus', 'ΠΩΘΥ', RU.text0783, 'craft'], ['hephaestus', 'ΘΥΠΩ', RU.text0784, 'completion'],
    ['hermes', 'ΣΕΡΜΗ', RU.text0785, 'exchange'], ['hermes', 'ΜΕΤΗ', RU.text0786, 'request'],
    ['hestia', 'ΦΕΓΗ', RU.text0787, 'rhythm'], ['hestia', 'ΣΗΤΗ', RU.text0788, 'stability'],
    ['dionysus', 'ΓΑΣΩ', RU.text0789, 'expression'], ['dionysus', 'ΣΑΓΩ', RU.text0790, 'creativity'],
];
export const RITUAL_FORMS: readonly LexicalEntry[] = ritualRows.map(([curatorId, displayForm, pronunciation, tag], index) => ({
    id: `ritual-${curatorId}-${index + 1}`, kind: 'ritual_form', displayForm, canonicalForm: normalizeGreek(displayForm, { archaic: false }), pronunciation, syllables: pronunciation.split('-'), stress: null,
    isopsephy: isopsephy(displayForm), curatorIds: [curatorId], sectorTags: SECTORS.filter(s => s.deities.includes(curatorId)).map(s => s.id), goalTags: [tag], valueTags: [], barrierTags: [], phoneticTags: [tag],
    easeScore: 0.7, dictionaryMeaning: null, intentionTemplates: [RU.text0791], sourceRefs: ['project:constructed-ritual-forms-v1'], reviewed: true, orthographyVersion: ORTHOGRAPHY_VERSION, contentVersion: LEXICON_VERSION,
}));
export function validateLexicalCatalog(): void {
    const all = [...LEXICON, ...RITUAL_FORMS, ...FALLBACK_NAMES], ids = new Set<string>();
    for (const entry of all) {
        if (ids.has(entry.id) || normalizeGreek(entry.displayForm) !== entry.canonicalForm || isopsephy(entry.displayForm) !== entry.isopsephy || !entry.pronunciation || !entry.reviewed || !entry.sourceRefs.length)
            throw new Error(`AURORA_INVALID_LEXICAL_ENTRY:${entry.id}`);
        ids.add(entry.id);
        if (entry.kind === 'ritual_form' && (entry.dictionaryMeaning !== null || entry.curatorIds.some(id => DEITIES[id].sum !== entry.isopsephy)))
            throw new Error(`AURORA_INVALID_PREPARED_FORM:${entry.id}`);
    }
    if (new Set(LEXICON.map(e => e.canonicalForm)).size < 120 || FALLBACK_NAMES.length !== 13 || CURATOR_IDS.some(id => RITUAL_FORMS.filter(e => e.curatorIds.includes(id)).length < 2))
        throw new Error('AURORA_LEXICON_COVERAGE');
    if (all.some(e => ![...e.canonicalForm].some(c => GREEK_VOWELS.includes(c))))
        throw new Error('AURORA_UNSPEAKABLE_FORM');
}
