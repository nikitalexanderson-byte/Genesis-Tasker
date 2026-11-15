"use client";

import { useId, useState, type ReactNode } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { translateText, type Language } from "./i18n";
import { STOICHEION_NUMERALS } from "./stoicheion-numerals";
import { greekIsopsephy, restorationRoot, restorationTrace } from "./stoicheion-restoration-math";
import type { TheokyklosSegmentId } from "./theokyklos-data";
import { OLYMPIAN_KNOWLEDGE, olympianCalculation, olympianFactorization, type KnowledgeCopy } from "./olympian-knowledge";
import type { OlympianDeity } from "./OlympianIsopsephy";
import { olympianBalance, olympianLetterEquation } from './olympian-reading-math';
import { SingleLineTitle } from './SingleLineTitle';

function RootMeaning({ number, copy, trace = false }: { number: number; copy: KnowledgeCopy; trace?: boolean }) {
  const root = restorationRoot(number);
  return <div className="olympian-root-meaning">
    <p><strong>{copy.root}: {root} · {copy[`rootName.${root}`]}</strong></p>
    {trace ? <p role="math">{restorationTrace(number).join(' → ')}</p> : null}
    <p>{copy[`rootMeaning.${root}`]}</p>
  </div>;
}

function WordReading({ word, copy }: { word: { greek: string; meaning: string; note: string; reference?: string }; copy: KnowledgeCopy }) {
  const calculation = olympianCalculation(word.greek);
  return <><p>{copy[word.note]}</p><p role="math" className="olympian-inline-equation">{olympianLetterEquation(word.greek)}</p>
    <RootMeaning number={calculation.number} copy={copy} trace />
    {word.reference ? <p role="math" className="olympian-inline-equation">{word.reference}: {olympianLetterEquation(word.reference)}</p> : null}</>;
}

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
        const label = <><span><strong>{copy[sector.title]}</strong><small>{copy[sector.patrons]}</small></span><span className="olympian-sector-sum">{sum}<small>{copy[`rootName.${restorationRoot(sum)}`]}</small></span></>;
        return <li key={sector.id}><details><summary>{label}<ExperimentalIcon name="chevron-down" /></summary>
          {sector.names.map(name => <p key={name} role="math" className="olympian-inline-equation">{name}: {olympianLetterEquation(name)}</p>)}
          {numbers.length > 1 ? <p role="math">{numbers.join(' + ')} = {sum}</p> : null}
          <RootMeaning number={sum} copy={copy} />
          {onOpenSector ? <button type="button" className="olympian-text-action" onClick={() => onOpenSector(sector.id)}>{copy.openSector}<ExperimentalIcon name="open" /></button> : null}
        </details></li>;
      })}</ul><p>{copy.pairNote}</p>
    </Disclosure>
    <Disclosure title={copy.restoration}><p>{copy.restorationText}</p><p className="olympian-formula-text" role="math">ρ(C + R + ΣA) = ρ(S)</p><p>{copy.restorationSymbols}</p><p>{copy.restorationExample}</p><p>{copy.restorationNote}</p><p>{copy.mathematicalReading}</p></Disclosure>
    <Disclosure title={copy.thirteen}><p>{copy.thirteenText}</p><h3>{copy.kronos}</h3><p>{copy.kronosText}</p><OlympianSources ids={['S10']} copy={copy} /></Disclosure>
    <Disclosure title={copy.bibliography}><p>{copy.sourceNote}</p><OlympianSources copy={copy} /></Disclosure>
  </Disclosure>;
}

function Comparison({ deity, deities, copy, language, onSelect, onOpenStoicheion }: { deity: OlympianDeity; deities: readonly OlympianDeity[]; copy: KnowledgeCopy; language: Language; onSelect?: (deity: OlympianDeity) => void } & OlympianNavigation) {
  const [otherId, setOtherId] = useState('');
  const selectId = useId();
  const other = deities.find(candidate => candidate.id === otherId);
  const interaction = other ? OLYMPIAN_KNOWLEDGE.interactions.find(item => item.ids.includes(deity.id) && item.ids.includes(other.id)) : undefined;
  const balance = other ? olympianBalance(deity.number, other.number) : undefined;
  const sharedRoot = balance?.root;
  return <div className="olympian-comparison">
    <label htmlFor={selectId}>{copy.compare}</label>
    <select id={selectId} value={otherId} onChange={event => setOtherId(event.target.value)}><option value="">{copy.comparePrompt}</option>{deities.filter(candidate => candidate.id !== deity.id).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name[language]} · {candidate.number}</option>)}</select>
    {other && interaction && balance ? <div className="olympian-comparison-result" aria-live="polite">
      <h4>{copy.mythMeeting}</h4><p>{copy[interaction.myth]}</p>
      <OlympianSources ids={interaction.sourceIds} copy={copy} />
      {[deity, other].map(item => <div key={item.id} className="olympian-comparison-name"><strong>{item.name[language]} <span lang="el">{item.greek}</span></strong><p role="math" className="olympian-inline-equation">{olympianLetterEquation(item.greek)}</p><RootMeaning number={item.number} copy={copy} /></div>)}
      <p>{copy.difference}: {Math.abs(deity.number - other.number)} · {restorationRoot(deity.number) === restorationRoot(other.number) ? copy.sameRoot : copy.differentRoots}</p>
      <p>{restorationRoot(deity.number) === restorationRoot(other.number) ? copy.rootKinship : copy.rootOtherContext}</p>
      <h4>{copy.pairRoot}</h4><p role="math">{deity.number} + {other.number} = {balance.sum}</p><RootMeaning number={balance.sum} copy={copy} />
      <h4>{copy.sharedWord}</h4><p><strong lang="el">{interaction.word.greek}</strong> · {copy[interaction.word.meaning]}</p><WordReading word={interaction.word} copy={copy} />
      <details className="olympian-shared-context"><summary>{copy.otherRootContext}<ExperimentalIcon name="chevron-down" /></summary>
        <p>{copy.otherRootContextText}</p>
        {[deity, other].map(item => { const word = OLYMPIAN_KNOWLEDGE.deities[item.id].rootWords.find(candidate => restorationRoot(greekIsopsephy(candidate.greek)) === sharedRoot)!; return <div key={item.id}><h4>{item.name[language]} · {copy[word.meaning]}</h4><p lang="el">{word.greek}</p><WordReading word={word} copy={copy} /></div>; })}
      </details>
      <h4>{copy.humanMeaning}</h4><p>{copy[interaction.life]}</p>
      <h4>{copy.balancePractice}</h4><p>{copy[interaction.practice]}</p>
      <Disclosure title={copy.balanceCalculation}><p>{copy.balanceExplanation}</p>
        <p role="math">{balance.sum} + {balance.letter}({balance.value}) = {balance.trace.join(' → ')}</p>
        <p role="math">{balance.sum} + {[...balance.alternative.letter].map(letter => `${letter}(${greekIsopsephy(letter)})`).join(' + ')} = {restorationTrace(balance.alternative.total).join(' → ')}</p>
        <RootMeaning number={balance.total} copy={copy} />
        {onOpenStoicheion ? [...new Set([balance.letter, ...balance.alternative.letter])].map(symbol => {
          const letter = STOICHEION_NUMERALS.find(candidate => candidate.symbol === symbol)!;
          return <button key={symbol} type="button" className="olympian-text-action" onClick={() => onOpenStoicheion(letter.id, { id: deity.id, name: `${copy.returnTo} · ${deity.name[language]}` })}>{symbol} · {copy.openLetter}<ExperimentalIcon name="open" /></button>;
        }) : null}
      </Disclosure>
      <p className="olympian-method-note">{copy.mathematicalReading}</p>
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
      <div className="olympian-letter-equation" aria-label={`${form}: ${olympianLetterEquation(form)}`}>
        {calculation.letters.map((letter, index) => <button type="button" key={`${index}-${letter}`} aria-pressed={selectedLetter === index} aria-label={`${copy.letter}: ${letter}, ${calculation.summands[index]}`} onClick={() => setSelectedLetter(selectedLetter === index ? null : index)}><strong lang="el">{letter}</strong><span>{calculation.summands[index]}</span></button>)}
        <span className="olympian-letter-total">= {calculation.number}</span>
      </div>
      <p className="olympian-equation olympian-equation-readable" role="math" aria-live="polite">{olympianLetterEquation(form)}</p>
      {numeral ? <div className="olympian-letter-note" aria-live="polite"><strong><span lang="el">{numeral.symbol}</span> · {translateText(numeral.name, language)} · {numeral.value}</strong>{onOpenStoicheion ? <button type="button" className="olympian-text-action" onClick={() => onOpenStoicheion(numeral.id, { id: deity.id, name: `${copy.returnTo} · ${deity.name[language]}` })}>{copy.openLetter}<ExperimentalIcon name="open" /></button> : null}</div> : null}
      <details className="olympian-root-disclosure"><summary>{copy.root}: <strong>{calculation.root} · {copy[`rootName.${calculation.root}`]}</strong><ExperimentalIcon name="chevron-down" /></summary><p role="math">{calculation.trace.join(' → ')}</p><p>{copy[`rootMeaning.${calculation.root}`]}</p><p>{copy.rootExplanation}</p><p>{calculation.number} = {olympianFactorization(calculation.number)}</p></details>
      <p className="olympian-method-note">{copy.normalization}</p>
    </Disclosure>
    <Disclosure title={copy.sources} hint={copy.sourcesHint}>
      <h3>{copy.ancient}</h3><p>{copy[knowledge.ancient]}</p>
      <h3>{copy.context}</h3><p>{copy[knowledge.sacred]}</p>
      <h3>{copy.formula}</h3><p>{copy[knowledge.formula]}</p>
      <p className="olympian-method-note">{copy.mathematicalReading}</p>
      <OlympianSources ids={knowledge.sourceIds} copy={copy} />
    </Disclosure>
    <Disclosure title={copy.words} hint={copy.wordsHint}>
      <p className="olympian-field-hint">{copy.relationExplanation}</p>
      <div className="olympian-word-list">{knowledge.words.map(word => {
        const wordCalculation = olympianCalculation(word.greek);
        const number = wordCalculation.number;
        return <details className="olympian-word" key={word.greek}><summary><span><strong lang="el"><SingleLineTitle text={word.greek} className="olympian-word-title" /></strong><small>{copy[word.meaning]}</small></span><span className="olympian-word-value">{number}<small>{copy[word.relation]}</small></span><ExperimentalIcon name="chevron-down" /></summary><div><WordReading word={word} copy={copy} /></div></details>;
      })}</div>
      <Disclosure title={copy.nineWords} hint={copy.nineWordsHint} className="olympian-nine-roots">
        <p>{copy.nineWordsIntro}</p>
        <div className="olympian-word-list">{knowledge.rootWords.map(word => {
          const number = greekIsopsephy(word.greek); const root = restorationRoot(number);
          return <details className="olympian-word olympian-root-word" key={word.greek}><summary><span><strong lang="el"><SingleLineTitle text={word.greek} className="olympian-word-title" /></strong><small>{copy[word.meaning]}</small></span><span className="olympian-word-value">{root}<small>{copy[`rootName.${root}`]}</small></span><ExperimentalIcon name="chevron-down" /></summary><div><WordReading word={word} copy={copy} /></div></details>;
        })}</div><p className="olympian-method-note">{copy.mathematicalReading}</p>
      </Disclosure>
    </Disclosure>
    <Disclosure title={copy.life} hint={copy.lifeHint}>
      <h3>{copy.interpretation}</h3><p>{copy.mathematicalReading}</p>
      <div className="olympian-situations">{knowledge.situations.map(situation => <details key={situation.title}><summary>{copy[situation.title]}<ExperimentalIcon name="chevron-down" /></summary><p>{copy[situation.body]}</p></details>)}</div>
      <h3>{copy.sector}</h3><p>{copy[knowledge.bridge]}</p>
      {onOpenSector ? <button type="button" className="olympian-sector-action" onClick={() => onOpenSector(knowledge.sectorId)}><ExperimentalIcon name="section-theokyklos" /><span><strong>{copy[sector.title]}</strong><small>{copy[sector.patrons]}</small></span><ExperimentalIcon name="open" /></button> : null}
      {onSelect ? <div className="olympian-related">{knowledge.relatedIds.map(id => { const related = deities.find(candidate => candidate.id === id)!; return <button type="button" key={id} onClick={() => onSelect(related)}><img src={`/theokyklos-symbols/olympian-${id}-v313.png`} alt="" width="32" height="32" /><span>{related.name[language]}</span><ExperimentalIcon name="chevron" /></button>; })}</div> : null}
      <Comparison deity={deity} deities={deities} copy={copy} language={language} onSelect={onSelect} onOpenStoicheion={onOpenStoicheion} />
      <Disclosure title={copy.limits}><p>{copy[knowledge.limits]}</p></Disclosure>
    </Disclosure>
  </div>;
}
