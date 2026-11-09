import RU from './texts.ru.json';
import { normalizeGreek } from './greek';
import { weightedJaccard } from './organon';
import { SPHRAGISES, type SphragisRecord } from './catalog/sphragises';
export type ComfortMode = 'gesture' | 'without_hands' | 'visual' | 'mental';
export function chooseSphragis(word: string, intentTags: readonly string[], comfort: ComfortMode, preferredLetter: string | null = null): SphragisRecord {
    const form = normalizeGreek(word, { archaic: false });
    const pool = SPHRAGISES.filter(s => form.includes(s.letter));
    if (!pool.length)
        throw new Error('AURORA_NO_SPHRAGIS_IN_WORD');
    if (preferredLetter) {
        const selected = pool.find(s => s.letter === preferredLetter);
        if (!selected)
            throw new Error('AURORA_SPHRAGIS_NOT_IN_WORD');
        return selected;
    }
    return pool.map(s => ({ s, score: Math.round((0.6 * weightedJaccard(s.intentTags, intentTags) + 0.25 * (comfort === 'gesture' ? 0.9 : 1) + 0.15 * ([...form].filter(l => l === s.letter).length / form.length)) * 1e6) }))
        .sort((a, b) => b.score - a.score || SPHRAGISES.indexOf(a.s) - SPHRAGISES.indexOf(b.s))[0].s;
}
export function ritualInstructions(minutes: 1 | 3 | 5, word: string, intention: string, sphragis: SphragisRecord, comfort: ComfortMode, ecphonesis = false): string[] {
    if (![1, 3, 5].includes(minutes) || !normalizeGreek(word).includes(sphragis.letter) || !intention.trim())
        throw new Error('AURORA_INVALID_RITUAL');
    const steps = [sphragis.seated, (RU.text1683 + intention + "\u00BB."), comfort === 'gesture' ? sphragis.gesture : comfort === 'without_hands' ? sphragis.withoutHands : sphragis.visual, (RU.text1684 + (comfort === 'mental' ? RU.text1685 : RU.text1686) + RU.text1687 + word + RU.text1688)];
    if (minutes >= 3)
        steps.push(RU.text1689);
    if (minutes === 5)
        steps.push(RU.text1690);
    if (ecphonesis)
        steps.push(RU.text1691);
    steps.push(RU.text1692);
    return steps;
}
