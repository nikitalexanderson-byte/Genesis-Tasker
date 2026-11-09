import {unifiedSuitability,type DrawHarmony} from './draw-harmony';
import RU from './texts.ru.json';
import { GREEK_VALUES, GREEK_VOWELS, ORDINARY_GREEK, ORTHOGRAPHY_VERSION, isopsephy, normalizeGreek } from './greek';
import { DEITIES, type CuratorId } from './registry';
import { LEXICON, RITUAL_FORMS, FALLBACK_NAMES, LEXICON_VERSION, type LexicalEntry } from './catalog/lexicon';
import {openSyllables,phoneme,rhythmicPatterns,wordHarmony} from './organon-harmony';
export const ORGANON_VERSION = 'aurora-exact-organon-v2';
export const SEARCH_LIMITS = Object.freeze({ states: 100000, candidates: 256, maxLength: 13, minLength: 2 });
export type OrganonPreferences = {
    drawHarmony?: DrawHarmony;
    goalTags: string[];
    qualityTags: string[];
    valueTags: string[];
    barrierTags: string[];
    lastFiveCanonicalForms: string[];
    excludedCanonicalForms: string[];
    preferShort: boolean;
    avoidedLetters: string[];
};
export type OrganonSelection = {
    entry: LexicalEntry;
    tier: 'lexicon' | 'prepared' | 'generated' | 'fallback';
    score: number;
    candidateIds: string[];
    algorithmVersion: string;
    lexiconVersion: string;
    preferences: OrganonPreferences;
    searchStates: number;
};
export function weightedJaccard(a: readonly string[], b: readonly string[], weights: Readonly<Record<string, number>> = {}): number {
    const aa = new Set(a), bb = new Set(b), union = new Set([...aa, ...bb]);
    let numerator = 0, denominator = 0;
    for (const tag of union) {
        const weight = weights[tag] ?? 1;
        if (!Number.isFinite(weight) || weight < 0)
            throw new Error('AURORA_INVALID_TAG_WEIGHT');
        denominator += weight;
        if (aa.has(tag) && bb.has(tag))
            numerator += weight;
    }
    return denominator ? numerator / denominator : 0;
}
const allowedClusters = new Set(['ΣΤ', 'ΠΡ', 'ΚΡ', 'ΦΡ', 'ΘΡ', 'ΧΡ', 'ΣΧ', 'ΤΡ', 'ΓΡ', 'ΔΡ', 'ΜΝ', 'ΓΝ', 'ΚΛ', 'ΓΛ', 'ΠΛ', 'ΦΛ', 'ΧΛ', 'ΣΠ', 'ΣΚ', 'ΣΜ', 'ΣΝ', 'ΝΔ', 'ΝΘ', 'ΝΤ', 'ΝΓ', 'ΝΚ', 'ΜΠ', 'ΜΒ', 'ΡΜ', 'ΡΘ', 'ΡΤ', 'ΡΧ', 'ΛΛ', 'ΣΣ', 'ΤΤ', 'ΓΓ', 'ΝΝ', 'ΜΜ', 'ΡΡ', 'ΛΘ', 'ΛΦ', 'ΛΚ', 'ΡΣ', 'ΡΓ', 'ΡΔ', 'ΡΚ', 'ΡΦ', 'ΡΠ', 'ΛΠ', 'ΚΤ', 'ΠΤ', 'ΦΘ', 'ΧΘ', 'ΚΣ', 'ΠΣ']);
const vowel = (letter: string) => GREEK_VOWELS.includes(letter);
const onsetClusters=new Set(['ΣΤ','ΠΡ','ΚΡ','ΦΡ','ΘΡ','ΧΡ','ΣΧ','ΤΡ','ΓΡ','ΔΡ','ΜΝ','ΓΝ','ΚΛ','ΓΛ','ΠΛ','ΦΛ','ΧΛ','ΣΠ','ΣΚ','ΣΜ']);
const sound = phoneme;
const fingerprint=(form:string)=>[...form].map(sound).join('');
const syllableSounds = (form:string) => openSyllables(form).map(pair=>[...pair].map(sound).join(''));
/** Orthographic aliases count as the same sound: Η/Ε, Υ/Ι, Ω/Ο and Θ/Τ. */
export function phoneticDiversityScore(form:string):number {
    const syllables=syllableSounds(form),consonants=syllables.flatMap(s=>[...s].filter(c=>!vowel(c))),vowels=syllables.map(s=>s.at(-1)!).filter(vowel);
    if(!syllables.length)return 0;
    return (2*new Set(syllables).size/syllables.length+(consonants.length?new Set(consonants).size/consonants.length:0)
        +(vowels.length?new Set(vowels).size/vowels.length:0))/4;
}
const stableHash=(value:string)=>{let hash=2166136261;for(const letter of value)hash=Math.imul(hash^letter.charCodeAt(0),16777619);return hash>>>0;};
export function rhythmScore(canonicalForm: string): number {
    let same = 0, illegal = 0;
    for (let i = 1; i < canonicalForm.length; i++) {
        if (vowel(canonicalForm[i - 1]) === vowel(canonicalForm[i]))
            same++;
        if (!vowel(canonicalForm[i - 1]) && !vowel(canonicalForm[i]) && !allowedClusters.has(canonicalForm.slice(i - 1, i + 1)))
            illegal++;
    }
    return 1 - Math.min(1, (same + 2 * illegal) / Math.max(1, canonicalForm.length - 1));
}
function permitted(entry: LexicalEntry, id: CuratorId, prefs: OrganonPreferences): boolean {
    const form = entry.canonicalForm;
    return entry.reviewed && entry.kind !== 'morpheme' && entry.isopsephy === DEITIES[id].sum && isopsephy(form) === DEITIES[id].sum
        && form.length >= 2 && form.length <= 13 && [...form].some(vowel) && Boolean(entry.pronunciation)
        && ![...prefs.excludedCanonicalForms,...prefs.lastFiveCanonicalForms].some(previous=>fingerprint(previous)===fingerprint(form))
        && !prefs.avoidedLetters.some(l => form.includes(l));
}
export function organonScore(entry: LexicalEntry, prefs: OrganonPreferences): number {
    const w = entry.canonicalForm, length = w.length, phi = (1 + Math.sqrt(5)) / 2;
    const e = entry.easeScore * (prefs.preferShort ? Math.max(0.25, 1 - (length - 2) / 14) : 1), r = rhythmScore(w);
    const q = weightedJaccard(entry.phoneticTags, prefs.qualityTags), m = weightedJaccard([...entry.goalTags, ...entry.valueTags, ...entry.barrierTags], [...prefs.goalTags, ...prefs.valueTags, ...prefs.barrierTags]);
    const t = (e + 2 * r + 3 * q + 4 * m) / 10, fib = 1 / (1 + Math.min(...[3, 5, 8, 13].map(f => Math.abs(length - f))));
    const ratio = [...w].filter(vowel).length / length, gold = Math.max(0, 1 - Math.abs(ratio - phi ** -2) / Math.max(phi ** -2, 1 - phi ** -2));
    let matching = 0;
    for (let i = 0; i < Math.floor(length / 2); i++)
        if (w[i] === w[length - i - 1])
            matching++;
    const pal = matching / Math.floor(length / 2), novel = prefs.lastFiveCanonicalForms.includes(w) ? 0 : 1;
    const diversity=phoneticDiversityScore(w);
    const currentSounds=new Set(syllableSounds(w));
    const similarity=Math.max(0,...prefs.lastFiveCanonicalForms.map(previous=>{
        const old=new Set(syllableSounds(previous)),union=new Set([...currentSounds,...old]);
        return [...currentSounds].filter(s=>old.has(s)).length/Math.max(1,union.size);
    }));
    return Math.round(unifiedSuitability(0.6 * t + 0.08 * fib + 0.08 * gold + 0.02 * pal + 0.1 * novel
        +0.06*diversity+0.06*wordHarmony(w).total-0.08*similarity, prefs.drawHarmony, entry.isopsephy) * 1e6) / 1e6;
}
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function choose(pool: readonly LexicalEntry[], id: CuratorId, prefs: OrganonPreferences) {
    return pool.filter(e => permitted(e, id, prefs)).map(entry => ({ entry, score: organonScore(entry, prefs) }))
        .sort((a, b) => Number(prefs.lastFiveCanonicalForms.includes(a.entry.canonicalForm))-Number(prefs.lastFiveCanonicalForms.includes(b.entry.canonicalForm))
            ||b.score - a.score || order(a.entry.canonicalForm, b.entry.canonicalForm) || order(a.entry.id, b.entry.id));
}
const reading: Readonly<Record<string, string>> = { Α: RU.text1631, Β: RU.text1632, Γ: RU.text1633, Δ: RU.text1634, Ε: RU.text1635, Ζ: RU.text1636, Η: RU.text1635, Θ: RU.text1637, Ι: RU.text1638, Κ: RU.text1639, Λ: RU.text1640, Μ: RU.text1641, Ν: RU.text1642, Ξ: RU.text1643, Ο: RU.text1644, Π: RU.text1645, Ρ: RU.text1646, Σ: RU.text1647, Τ: RU.text1637, Υ: RU.text1638, Φ: RU.text1648, Χ: RU.text1649, Ψ: RU.text1650, Ω: RU.text1644 };
const forbiddenForms = new Set(['ΣΚΑΤΑ', 'ΠΟΡΝΗ', 'ΠΟΡΝΟΣ', 'ΦΟΝΟΣ', 'ΜΙΣΟΣ']);
/** Stratified, bounded beam search with exact phonotactic reachability.
 * Used in a worker/prebuild, never from a React render. Only ordinary letters.
 */
export function generateOrganonCandidates(id: CuratorId, prefs: OrganonPreferences): {
    entries: LexicalEntry[];
    states: number;
    limitReached: boolean;
} {
    const target = DEITIES[id]?.sum;
    if (!target || isopsephy(DEITIES[id].greekDisplayName) !== target)
        throw new Error('AURORA_INVALID_CURATOR');
    const alphabet = [...ORDINARY_GREEK].filter(l => !prefs.avoidedLetters.includes(l));
    const letters=[alphabet.filter(l=>!vowel(l)),alphabet.filter(vowel)];
    const entries: LexicalEntry[] = [];
    let states = 0, limitReached = false;
    const seed=[id,...[...prefs.goalTags].sort(),...prefs.lastFiveCanonicalForms,...prefs.excludedCanonicalForms,JSON.stringify(prefs.drawHarmony??{})].join('|');
    const excludedSounds=new Set([...prefs.lastFiveCanonicalForms,...prefs.excludedCanonicalForms].map(fingerprint));
    type State={form:string;sum:number;quality:number;tie:number};
    const compare=(a:State,b:State)=>b.quality-a.quality||a.tie-b.tie||order(a.form,b.form);
    // Round-robin initial-sound strata prevent a large alphabetic prefix from consuming the budget.
    const beam=(pool:State[],limit:number)=>{
        const groups=new Map<string,State[]>();
        for(const row of pool.sort(compare)){const key=sound(row.form[0]);const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
        const queues=[...groups.values()].sort((a,b)=>compare(a[0],b[0])),selected:State[]=[];
        for(let cursor=0;selected.length<limit;cursor++){
            let found=false;for(const group of queues)if(group[cursor]){selected.push(group[cursor]);found=true;if(selected.length===limit)break;}
            if(!found)break;
        }
        return selected;
    };
    const patterns=rhythmicPatterns(prefs.preferShort);
    search:for(const pattern of patterns){
        const length=pattern.length;
        const reach=Array.from({length:length+1},()=>new Uint8Array(target+1));
        reach[length][0]=1;
        for(let position=length-1;position>=0;position--)for(let sum=1;sum<=target;sum++){
            reach[position][sum]=Number(letters[pattern[position]].some(l=>sum>=GREEK_VALUES[l]&&reach[position+1][sum-GREEK_VALUES[l]]));
        }
        if(!reach[0][target])continue;
        const patternStart=states;
        let frontier:State[]=[{form:'',sum:0,quality:0,tie:0}];
        let patternExhausted=false;
        for(let position=0;position<length;position++){
            const next:State[]=[];
            expansion:for(const state of frontier)for(const letter of letters[pattern[position]]){
                if(states===SEARCH_LIMITS.states){limitReached=true;break search;}states++;
                if(states-patternStart>6000){limitReached=true;patternExhausted=true;break expansion;}
                const sum=state.sum+GREEK_VALUES[letter],remaining=target-sum;
                if(remaining<0||!reach[position+1][remaining])continue;
                const form=state.form+letter,phonemes=[...form].map(sound);
                if(pattern[position]===0){
                    const consonants=phonemes.filter(c=>!vowel(c));
                    if(consonants.slice(0,-1).filter(c=>c===sound(letter)).length>=2)continue;
                    if(position>0&&pattern[position-1]===0&&!onsetClusters.has(form.slice(-2)))continue;
                }else{
                    const syllables=syllableSounds(form);
                    if(new Set(syllables).size!==syllables.length)continue;
                    if(phonemes.filter(c=>vowel(c)&&c===sound(letter)).length>2)continue;
                }
                next.push({form,sum,quality:(phoneticDiversityScore(form)+wordHarmony(form).total)/2,tie:stableHash(seed+'|'+form)});
            }
            frontier=beam(next,48);
            if(patternExhausted||!frontier.length)break;
        }
        if(patternExhausted)continue;
        for(const state of beam(frontier.filter(row=>row.sum===target&&row.form.length===length
            &&!forbiddenForms.has(row.form)&&!prefs.excludedCanonicalForms.includes(row.form)
            &&!excludedSounds.has(fingerprint(row.form))),13)){
            const pronunciation=openSyllables(state.form).map(s=>[...s].map(l=>reading[l]).join('')).join('-');
            entries.push({id:`generated-${id}-${state.form}`,kind:'ritual_form',displayForm:state.form,canonicalForm:state.form,
                pronunciation,syllables:pronunciation.split('-'),stress:null,isopsephy:target,curatorIds:[id],sectorTags:[],
                goalTags:[...prefs.goalTags],valueTags:[],barrierTags:[],phoneticTags:[...prefs.qualityTags],easeScore:0.7+0.2*state.quality,
                dictionaryMeaning:null,intentionTemplates:[],sourceRefs:['project:stratified-phonetic-beam-v2'],reviewed:true,
                orthographyVersion:ORTHOGRAPHY_VERSION,contentVersion:LEXICON_VERSION});
        }
    }
    return { entries, states, limitReached };
}
export function selectOrganon(id: CuratorId, prefs: OrganonPreferences, allowGeneration = false): OrganonSelection {
    if (!DEITIES[id]?.curatorEligible || prefs.lastFiveCanonicalForms.length > 5)
        throw new Error('AURORA_INVALID_ORGANON_INPUT');
    for (const l of prefs.avoidedLetters)
        if (normalizeGreek(l, { archaic: false }).length !== 1)
            throw new Error('AURORA_INVALID_PHONETIC_PREFERENCE');
    let states = 0;
    for (const [tier, pool] of [['lexicon', LEXICON], ['prepared', RITUAL_FORMS]] as const) {
        if(tier==='prepared'&&allowGeneration)continue;
        const ranked = choose(pool, id, prefs);
        if (ranked.length&&!prefs.lastFiveCanonicalForms.includes(ranked[0].entry.canonicalForm))
            return { entry: ranked[0].entry, tier, score: ranked[0].score, candidateIds: ranked.map(c => c.entry.id), algorithmVersion: ORGANON_VERSION, lexiconVersion: LEXICON_VERSION, preferences: structuredClone(prefs), searchStates: 0 };
    }
    if (allowGeneration) {
        const generated = generateOrganonCandidates(id, prefs);
        states = generated.states;
        const ranked = choose([...RITUAL_FORMS,...generated.entries], id, prefs);
        if (ranked.length)
            return { entry: ranked[0].entry, tier: ranked[0].entry.id.startsWith('generated-')?'generated':'prepared', score: ranked[0].score, candidateIds: ranked.map(c => c.entry.id), algorithmVersion: ORGANON_VERSION, lexiconVersion: LEXICON_VERSION, preferences: structuredClone(prefs), searchStates: states };
    }
    const fallback = choose(FALLBACK_NAMES, id, prefs)[0];
    if (!fallback)
        throw new Error('AURORA_NO_COMFORTABLE_EXACT_FORM');
    return { entry: fallback.entry, tier: 'fallback', score: fallback.score, candidateIds: [fallback.entry.id], algorithmVersion: ORGANON_VERSION, lexiconVersion: LEXICON_VERSION, preferences: structuredClone(prefs), searchStates: states };
}
