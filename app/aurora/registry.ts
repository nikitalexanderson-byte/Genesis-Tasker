import RU from './texts.ru.json';
import { isopsephy, normalizeGreek } from './greek';
export const REGISTRY_VERSION = 'aurora-grc-names-v1';
export const SECTOR_IDS = ['northwest', 'north', 'northeast', 'west', 'center', 'east', 'southwest', 'south', 'southeast'] as const;
export type SectorId = typeof SECTOR_IDS[number];
export const CURATOR_IDS = ['zeus', 'hera', 'poseidon', 'demeter', 'athena', 'apollo', 'artemis', 'ares', 'aphrodite', 'hephaestus', 'hermes', 'hestia', 'dionysus'] as const;
export type CuratorId = typeof CURATOR_IDS[number];
export type DeityId = CuratorId | 'kronos';
export type DeityDefinition = {
    id: DeityId;
    name: string;
    greekDisplayName: string;
    canonicalForm: string;
    sum: number;
    curatorEligible: boolean;
    sourceUrl: string;
    variantNote: string;
};
const entries: [
    DeityId,
    string,
    string,
    string,
    number,
    string?
][] = [
    ['zeus', RU.text1651, 'Ζεύς', 'ΖΕΥΣ', 612], ['hera', RU.text1652, 'Ἥρα', 'ΗΡΑ', 109],
    ['poseidon', RU.text1653, 'Ποσειδῶν', 'ΠΟΣΕΙΔΩΝ', 1219], ['demeter', RU.text1654, 'Δημήτηρ', 'ΔΗΜΗΤΗΡ', 468],
    ['athena', RU.text1655, 'Ἀθηνᾶ', 'ΑΘΗΝΑ', 69, 'Ancient contracted Attic nominative; Ἀθήνη=76 and Ἀθηναία=80 are distinct forms.'],
    ['apollo', RU.text1656, 'Ἀπόλλων', 'ΑΠΟΛΛΩΝ', 1061], ['artemis', RU.text1657, 'Ἄρτεμις', 'ΑΡΤΕΜΙΣ', 656],
    ['ares', RU.text1658, 'Ἄρης', 'ΑΡΗΣ', 309], ['aphrodite', RU.text1659, 'Ἀφροδίτη', 'ΑΦΡΟΔΙΤΗ', 993],
    ['hephaestus', RU.text1660, 'Ἥφαιστος', 'ΗΦΑΙΣΤΟΣ', 1289], ['hermes', RU.text1661, 'Ἑρμῆς', 'ΕΡΜΗΣ', 353],
    ['hestia', RU.text1662, 'Ἑστία', 'ΕΣΤΙΑ', 516], ['dionysus', RU.text1663, 'Διόνυσος', 'ΔΙΟΝΥΣΟΣ', 1004, 'Nominative Διόνυσος, never substitute epic Διώνυσος=1734.'],
    ['kronos', RU.text1664, 'Κρόνος', 'ΚΡΟΝΟΣ', 510, 'Boundary aspect of time; Χρόνος=1090 is a separate spelling of the flow aspect, never a second trump.'],
];
export const DEITIES: Readonly<Record<DeityId, DeityDefinition>> = Object.freeze(Object.fromEntries(entries.map(([id, name, greekDisplayName, canonicalForm, sum, note]) => {
    if (normalizeGreek(greekDisplayName) !== canonicalForm || isopsephy(greekDisplayName) !== sum)
        throw new Error('AURORA_DEITY_REGISTRY_INVALID');
    return [id, Object.freeze({ id, name, greekDisplayName, canonicalForm, sum, curatorEligible: id !== 'kronos', sourceUrl: `https://cld.bbaw.de/lemma/grc/${encodeURIComponent(id === 'athena' ? 'Ἀθήνη' : greekDisplayName)}`, variantNote: note ?? 'Fixed ancient nominative singular; breathing is not a separate letter.' })];
}))) as Readonly<Record<DeityId, DeityDefinition>>;
export const TIME_PRINCIPLE = Object.freeze({ principleId: 'time', boundaryAspect: 'kronos', flowAspect: 'chronos', operatorName: 'Κρόνος' });
export const SECTORS: readonly {
    id: SectorId;
    title: string;
    meaning: string;
    deities: readonly DeityId[];
}[] = [
    { id: 'northwest', title: RU.text1665, meaning: RU.text1666, deities: ['hera', 'artemis'] },
    { id: 'north', title: RU.text1667, meaning: RU.text1668, deities: ['poseidon'] },
    { id: 'northeast', title: RU.text1669, meaning: RU.text1670, deities: ['zeus'] },
    { id: 'west', title: RU.text1671, meaning: RU.text1672, deities: ['hermes'] },
    { id: 'center', title: RU.text1673, meaning: RU.text1674, deities: ['kronos', 'hestia'] },
    { id: 'east', title: RU.text1675, meaning: RU.text1676, deities: ['apollo', 'athena'] },
    { id: 'southwest', title: RU.text1677, meaning: RU.text1678, deities: ['demeter', 'hephaestus'] },
    { id: 'south', title: RU.text1679, meaning: RU.text1680, deities: ['ares'] },
    { id: 'southeast', title: RU.text1681, meaning: RU.text1682, deities: ['aphrodite', 'dionysus'] },
];
