"use client";

import { useId, useState, type ReactNode } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { translateText, type Language } from "./i18n";
import { STOICHEION_NUMERALS } from "./stoicheion-numerals";
import { greekIsopsephy, restorationRoot } from "./stoicheion-restoration-math";
import type { TheokyklosSegmentId } from "./theokyklos-data";
import { OLYMPIAN_KNOWLEDGE, olympianCalculation, olympianFactorization, type KnowledgeCopy } from "./olympian-knowledge";
import type { OlympianDeity } from "./OlympianIsopsephy";

export type OlympianNavigation = {
  onOpenStoicheion?: (cardId?: string, returnTo?: { id: string; name: string }) => void;
  onOpenSector?: (sectorId: TheokyklosSegmentId) => void;
};

function Disclosure({ title, hint, children, open = false, className = "" }: {
  title: string; hint?: string; children: ReactNode; open?: boolean; className?: string;
}) {
  return <details className={`olympian-disclosure-section ${className}`.trim()} open={open || undefined}>
    <summary><span><strong>{title}</strong>{hint ? <small>{hint}</small> : null}</span><ExperimentalIcon name="chevron-down" /></summary>
    <div className="olympian-section-content">{children}</div>
  </details>;
}

export function OlympianSources({ ids, copy }: { ids?: readonly string[]; copy: KnowledgeCopy }) {
  const sources = OLYMPIAN_KNOWLEDGE.sources.filter(source => !ids || ids.includes(source.id));
  return <ul className="olympian-source-list">{sources.map(source => <li key={source.id}>
    <a href={source.url} target="_blank" rel="noreferrer">
      <span><strong>{copy[source.author]} · {copy[source.work]}</strong><small>{copy[source.passage]}</small></span>
      <ExperimentalIcon name="open" />
    </a>
  </li>)}</ul>;
}

export function OlympianGuide({ copy, onOpenSector }: { copy: KnowledgeCopy; onOpenSector?: OlympianNavigation["onOpenSector"] }) {
  return <Disclosure title={copy.guide} hint={copy.guideHint} className="olympian-guide">
    <h3>{copy.layers}</h3><p>{copy.layersText}</p>
    <h3>{copy.method}</h3><p>{copy.methodText}</p>
    <Disclosure title={copy.alphabet}>
      <dl className="olympian-alphabet">{STOICHEION_NUMERALS.map(letter => <div key={letter.id}><dt lang="el">{letter.symbol}</dt><dd>{letter.value}</dd></div>)}
        {[['ϛ / ϝ', 6], ['ϟ / ϙ', 90], ['ϡ', 900]].map(([symbol, value]) => <div key={symbol} className="olympian-archaic"><dt lang="el">{symbol}</dt><dd>{value}</dd></div>)}
      </dl><p>{copy.alphabetNote}</p><p>{copy.normalization}</p>
    </Disclosure>
    <Disclosure title={copy.numberGuide}>
      <ol className="olympian-number-guide">{OLYMPIAN_KNOWLEDGE.numbers.map(number => <li key={number.value}><span aria-hidden="true">{number.value}</span><p>{copy[number.body]}</p></li>)}</ol>
      <p>{copy.arithmeticExtra}</p>
      <OlympianSources ids={['S2', 'S11', 'S13', 'S16']} copy={copy} />
    </Disclosure>
    <Disclosure title={copy.sectorMap}>
      <p>{copy.sectorMapNote}</p>
      <ul className="olympian-sector-list">{OLYMPIAN_KNOWLEDGE.sectors.map(sector => {
        const numbers = sector.names.map(greekIsopsephy);
        const sum = numbers.reduce((a, b) => a + b, 0);
        const label = <><span><strong>{copy[sector.title]}</strong><small>{copy[sector.patrons]}</small><span lang="el">{sector.names.join(' + ')}</span></span><span className="olympian-sector-sum">{numbers.join(' + ')}{numbers.length > 1 ? ` = ${sum}` : ''}<small>{copy.root}: {restorationRoot(sum)}</small></span></>;
        return <li key={sector.id}>{onOpenSector ? <button type="button" onClick={() => onOpenSector(sector.id)}>{label}<ExperimentalIcon name="chevron" /></button> : <div>{label}</div>}</li>;
      })}</ul><p>{copy.pairNote}</p>
    </Disclosure>
    <Disclosure title={copy.restoration}><p>{copy.restorationText}</p><p className="olympian-formula-text" role="math">ρ(C + R + ΣA) = ρ(S)</p><p>{copy.restorationExample}</p><p>{copy.restorationNote}</p></Disclosure>
    <Disclosure title={copy.thirteen}><p>{copy.thirteenText}</p><h3>{copy.kronos}</h3><p>{copy.kronosText}</p><OlympianSources ids={['S10']} copy={copy} /></Disclosure>
    <Disclosure title={copy.bibliography}><p>{copy.sourceNote}</p><OlympianSources copy={copy} /></Disclosure>
  </Disclosure>;
}

function Comparison({ deity, deities, copy, language, onSelect }: { deity: OlympianDeity; deities: readonly OlympianDeity[]; copy: KnowledgeCopy; language: Language; onSelect?: (deity: OlympianDeity) => void }) {
  const [otherId, setOtherId] = useState('');
  const selectId = useId();
  const other = deities.find(candidate => candidate.id === otherId);
  return <div className="olympian-comparison">
    <label htmlFor={selectId}>{copy.compare}</label>
    <select id={selectId} value={otherId} onChange={event => setOtherId(event.target.value)}><option value="">{copy.comparePrompt}</option>{deities.filter(candidate => candidate.id !== deity.id).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name[language]} · {candidate.number}</option>)}</select>
    {other ? <div className="olympian-comparison-result" aria-live="polite">
      <p><strong>{deity.name[language]} <span lang="el">{deity.greek}</span> = {deity.number}</strong><br /><strong>{other.name[language]} <span lang="el">{other.greek}</span> = {other.number}</strong></p>
      <p>{copy.difference}: {Math.abs(deity.number - other.number)} · {restorationRoot(deity.number) === restorationRoot(other.number) ? copy.sameRoot : copy.differentRoots} ({restorationRoot(deity.number)} / {restorationRoot(other.number)})</p>
      <p>{copy.compareHint}</p>
      {onSelect ? <button type="button" className="olympian-text-action" onClick={() => onSelect(other)}>{other.name[language]}<ExperimentalIcon name="chevron" /></button> : null}
    </div> : null}
  </div>;
}

export function OlympianKnowledge({ deity, deities, language, copy, onSelect, onOpenStoicheion, onOpenSector }: {
  deity: OlympianDeity; deities: readonly OlympianDeity[]; language: Language; copy: KnowledgeCopy;
  onSelect?: (deity: OlympianDeity) => void;
} & OlympianNavigation) {
  const knowledge = OLYMPIAN_KNOWLEDGE.deities[deity.id];
  const [form, setForm] = useState(deity.greek);
  const [selectedLetter, setSelectedLetter] = useState<number | null>(null);
  const formId = useId();
  const calculation = olympianCalculation(form);
  const numeral = selectedLetter === null ? undefined : STOICHEION_NUMERALS.find(letter => letter.symbol === calculation.letters[selectedLetter]);
  const sector = OLYMPIAN_KNOWLEDGE.sectors.find(candidate => candidate.id === knowledge.sectorId)!;
  return <div className="olympian-knowledge" data-knowledge={deity.id}>
    <Disclosure title={copy.calculate} hint={copy.calculateHint}>
      <label htmlFor={formId}>{copy.variant}</label>
      <select id={formId} value={form} onChange={event => { setForm(event.target.value); setSelectedLetter(null); }}>
        <option value={deity.greek}>{deity.greek} · {copy.nameForm}</option>
        {knowledge.variants.map(variant => <option key={variant.greek} value={variant.greek}>{variant.greek} · {copy[variant.label]}</option>)}
      </select>
      <p className="olympian-field-hint">{copy.letterHint}</p>
      <div className="olympian-letter-equation" aria-label={`${form}: ${calculation.summands.join(' + ')} = ${calculation.number}`}>
        {calculation.letters.map((letter, index) => <button type="button" key={`${index}-${letter}`} aria-pressed={selectedLetter === index} aria-label={`${copy.letter}: ${letter}, ${calculation.summands[index]}`} onClick={() => setSelectedLetter(selectedLetter === index ? null : index)}><strong lang="el">{letter}</strong><span>{calculation.summands[index]}</span></button>)}
        <span className="olympian-letter-total">= {calculation.number}</span>
      </div>
      <p className="olympian-equation olympian-equation-readable" role="math" aria-live="polite" aria-label={`${calculation.summands.join(' + ')} = ${calculation.number}`}>{calculation.summands.join(' + ')} = {calculation.number}</p>
      {numeral ? <div className="olympian-letter-note" aria-live="polite"><strong><span lang="el">{numeral.symbol}</span> · {translateText(numeral.name, language)} · {numeral.value}</strong>{onOpenStoicheion ? <button type="button" className="olympian-text-action" onClick={() => onOpenStoicheion(numeral.id, { id: deity.id, name: `${copy.returnTo} · ${deity.name[language]}` })}>{copy.openLetter}<ExperimentalIcon name="open" /></button> : null}</div> : null}
      <details className="olympian-root-disclosure"><summary aria-label={`${copy.root}: ${calculation.root}`}>{copy.root}: <strong>{calculation.root}</strong><ExperimentalIcon name="chevron-down" /></summary><p role="math">{calculation.trace.join(' → ')}</p><p>{copy.rootExplanation}</p><p>{calculation.number} = {olympianFactorization(calculation.number)}</p></details>
      <p className="olympian-method-note">{copy.normalization}</p>
    </Disclosure>
    <Disclosure title={copy.sources} hint={copy.sourcesHint}>
      <h3>{copy.ancient}</h3><p>{copy[knowledge.ancient]}</p>
      <h3>{copy.context}</h3><p>{copy[knowledge.sacred]}</p>
      <h3>{copy.formula}</h3><p>{copy[knowledge.formula]}</p>
      <OlympianSources ids={knowledge.sourceIds} copy={copy} />
    </Disclosure>
    <Disclosure title={copy.words} hint={copy.wordsHint}>
      <p className="olympian-field-hint">{copy.relationExplanation}</p>
      <div className="olympian-word-list">{knowledge.words.map(word => {
        const wordCalculation = olympianCalculation(word.greek);
        const number = wordCalculation.number;
        return <details className="olympian-word" key={word.greek}><summary><span><strong lang="el">{word.greek}</strong><small>{copy[word.meaning]}</small></span><span className="olympian-word-value">{number}<small>{copy[word.relation]}</small></span><ExperimentalIcon name="chevron-down" /></summary><div><p>{copy[word.note]}</p><p role="math">{wordCalculation.summands.join(' + ')} = {number}</p><p>{copy.root}: {wordCalculation.trace.join(' → ')}</p>{word.reference ? <p><span lang="el">{word.reference}</span> = {greekIsopsephy(word.reference)}</p> : null}</div></details>;
      })}</div>
    </Disclosure>
    <Disclosure title={copy.life} hint={copy.lifeHint}>
      <h3>{copy.interpretation}</h3><p>{copy[knowledge.meaning]}</p>
      <div className="olympian-situations">{knowledge.situations.map(situation => <details key={situation.title}><summary>{copy[situation.title]}<ExperimentalIcon name="chevron-down" /></summary><p>{copy[situation.body]}</p></details>)}</div>
      <h3>{copy.sector}</h3><p>{copy[knowledge.bridge]}</p>
      {onOpenSector ? <button type="button" className="olympian-sector-action" onClick={() => onOpenSector(knowledge.sectorId)}><ExperimentalIcon name="section-theokyklos" /><span><strong>{copy[sector.title]}</strong><small>{copy[sector.patrons]}</small></span><ExperimentalIcon name="open" /></button> : null}
      {onSelect ? <div className="olympian-related">{knowledge.relatedIds.map(id => { const related = deities.find(candidate => candidate.id === id)!; return <button type="button" key={id} onClick={() => onSelect(related)}><img src={`/theokyklos-symbols/olympian-${id}-v313.png`} alt="" width="32" height="32" /><span>{related.name[language]}</span><ExperimentalIcon name="chevron" /></button>; })}</div> : null}
      <Comparison deity={deity} deities={deities} copy={copy} language={language} onSelect={onSelect} />
      <Disclosure title={copy.limits}><p>{copy[knowledge.limits]}</p></Disclosure>
    </Disclosure>
  </div>;
}
