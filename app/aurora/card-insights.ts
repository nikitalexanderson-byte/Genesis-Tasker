import { getStoicheionLetters } from '../stoicheion-data';
import { SOURCE_CIRCLE_REFERENCE } from './source-model';
import { DEITIES,SECTORS } from './registry';
import type { DrawnCard } from './types';
import type { Language } from '../i18n';
import {RESTORATION_LETTER_FOCI} from '../stoicheion-restoration-data';
import {restorationLocal} from '../stoicheion-restoration-copy';
import {TRANSFORMATION_BRIDGES} from './transformation';
import {BASE_QUESTIONS} from './catalog/questions';

const FOCUS_FIELDS=['goal_is_own','explicit_agreement','small_step_possible','baseline_defined','cost_acceptable','resource_available','other_agreement','prior_exception','clear_scope','deadline_defined','reversible_step','scale_limit_known','source_known','values_share_constraint','pattern_same_context','decision_owner_known','stop_condition_known','inference_distinguished','voluntary_commitment','value_named','target_observable','condition_before_outcome','undesired_outcome_known','earlier_result_observed'];
const SOURCE_DOMAINS={northwest:'east',north:'east',northeast:'northwest',west:'north',center:'southeast',east:'west',southwest:'southwest',south:'south',southeast:'southwest'} as const;

/** Read the authored orientation section of this exact letter, never a generic sector diagnosis. */
export function cardInsight(card: DrawnCard,language:Language='ru',model:'source'|'desired'='source') {
  const original = getStoicheionLetters('ru').find(item => item.id === card.cardId);
  const letter = getStoicheionLetters(language).find(item => item.id === card.cardId);
  const sector = SECTORS.find(item => item.id === card.sourcePositionId);
  const source = SOURCE_CIRCLE_REFERENCE.find(item => item.id === card.sourcePositionId);
  if (!original || !letter || !sector || !source) throw new Error('AURORA_CARD_INSIGHT_UNAVAILABLE');
  const reversed = card.orientation === 'reversed';
  const paragraphs = original.content.split(/\n\s*\n/);
  const sectionIndex = paragraphs.findIndex(part => reversed
    ? /^Перев[её]рнут[а-яё]* положение/iu.test(part)
    : /^(?:Парадное|Прямое) положение/iu.test(part));
  const localized=letter.content.split(/\n\s*\n/);
  const [heading, ...lines] = (localized[sectionIndex] ?? '').split('\n').map(line => line.trim()).filter(Boolean);
  const focus=RESTORATION_LETTER_FOCI[card.cardId],index=getStoicheionLetters('ru').findIndex(row=>row.id===card.cardId);
  const question=BASE_QUESTIONS.find(row=>row.sectorTags.includes(model==='source'?SOURCE_DOMAINS[card.sourcePositionId]:card.sourcePositionId)&&row.resolvesFields[0]===FOCUS_FIELDS[index])!;
  return { cardId: card.cardId, name: letter.name, symbol: letter.symbol, sector: sector.title,
    focus:restorationLocal(reversed?focus.risk:focus.quality,language),bridge:TRANSFORMATION_BRIDGES[card.sourcePositionId].summary,question:question.text,
    sectorMeaning: model==='source'?source.meaning.ru:sector.meaning, patrons:model==='source'?source.patrons.ru:sector.deities.map(id=>DEITIES[id].name).join(', '), reversed,
    heading: heading || letter.tagline, lines: lines.map(line => line.replace(/^[-–]\s*/, '')) };
}
