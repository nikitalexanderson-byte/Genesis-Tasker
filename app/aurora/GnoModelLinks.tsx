/* eslint-disable @next/next/no-img-element -- Use the existing Olympian artwork. */
import {useState} from 'react';
import type {Language} from '../i18n';
import {catalogText} from '../catalog-i18n';
import olympians from '../olympian-isopsephy.json';
import {useOlympianCopy} from '../olympian-knowledge';
import {OlympianKnowledge, OlympianSources, OlympianGuide} from '../OlympianKnowledge';
import {olympianLetterEquation} from '../olympian-reading-math';
import {SECTOR_IDS,type SectorId} from './registry';
import {SOURCE_CIRCLE_REFERENCE} from './source-model';
import {EXTERNAL_SECTORS,INTRO_TRAITS,crossRelation,externalTarget,sourceCurator,olympianContext,type ModelDeity,EXTRA_DEITIES} from './gno-models';
import {guidedCopy} from './gno-guided';
import {gnoCopy} from './gno-copy';
import type {GnoDraft} from './gno-engine';

export function externalDeityName(id:ModelDeity,language:Language){
 const original=olympians.deities.find(d=>d.id===id);
 return original?.name[language]??guidedCopy(language).extraNames[Object.keys(EXTRA_DEITIES).indexOf(id)];
}
export function GnoModelLinks({draft,source,language,onTarget}:{draft:GnoDraft;source:SectorId;language:Language;onTarget:(id:SectorId)=>void}){
 const c=gnoCopy(language),g=guidedCopy(language),target=externalTarget(draft),index=SECTOR_IDS.indexOf(target);
 const relation=crossRelation(source,target),sector=EXTERNAL_SECTORS[target];
 const {copy,error,retry}=useOlympianCopy(language);
 const [selected,setSelected]=useState<string>('');
 const deity=olympians.deities.find(row=>row.id===(selected||sourceCurator(source)))!;
 const from=SOURCE_CIRCLE_REFERENCE.find(row=>row.id===source)!;
 const traitLabels:Record<string,string>={exchange:g.facetsList[0][3],travel:g.facetsList[0][2],communication:g.facetsList[0][0],strategy:g.facetsList[1][0],learning:g.facetsList[1][1],stability:g.facetsList[4][5],craft:g.facetsList[2][0],action:g.facetsList[2][5],expression:g.facetsList[7][3],rest:g.facetsList[3][2],emotion:g.facetsList[3][3],care:g.facetsList[5][0],boundary:g.facetsList[4][1],connection:g.facetsList[6][1],growth:g.facetsList[5][4],clarity:g.facetsList[7][0],desire:g.facetsList[6][2],resources:g.facetsList[8][1]};
 const common=INTRO_TRAITS[source].filter(t=>sector.traits.includes(t));
 return <section className="gno-model-links">
  <label className="gno-field"><span>{g.external}</span><select aria-label={g.external} value={target} onChange={e=>onTarget(e.target.value as SectorId)}>{SECTOR_IDS.map((id,i)=><option value={id} key={id}>{g.directions[i]} · {EXTERNAL_SECTORS[id].deities.map(d=>externalDeityName(d,language)).join(' / ')}</option>)}</select></label>
  <p className="gno-link-line">{catalogText(from.patrons,language)} → {sector.deities.map(d=>externalDeityName(d,language)).join(' / ')}</p>
  <p className="gno-muted"><span lang="el">{sector.wind}</span>{sector.wind?' · ':''}{g.elements[index]}</p>
  <ul className="gno-sector-facets">{g.facetsList[index].map(facet=><li key={facet}>{facet}</li>)}</ul>
  <p><strong>{g.connection}: </strong>{common.length?common.map(t=>traitLabels[t]).join(' · '):c.conditional}</p>
  <details><summary>{c.projection}</summary><p>{g.modelNote}</p><p>{catalogText(from.meaning,language)}</p>
   <div className="gno-external-map">{SECTOR_IDS.map((id,i)=><button type="button" className="secondary-button" aria-pressed={target===id} key={id} onClick={()=>onTarget(id)}><strong>{g.directions[i]}</strong><span>{EXTERNAL_SECTORS[id].deities.map(d=>externalDeityName(d,language)).join(' / ')}</span></button>)}</div>
   <p>{g.facets}: {g.facetsList[index].join(' · ')}</p>
   <code>S = |A ∩ B| / √(|A|·|B|) = {relation.semantic.toFixed(3)}<br/>C = .50 S + .25 I + .20 M + .05 N = {relation.score.toFixed(3)}</code><p>{c.symbolicNote}</p>
  </details>
  <details><summary>{c.myth}</summary>
   {!copy?<p role="status">{error?c.error:c.loading}{error?<button type="button" className="secondary-button" onClick={retry}>{c.retry}</button>:null}</p>:relation.myths.olympian.map(pair=><article key={pair.ids.join(':')}><h4>{pair.ids.map(id=>olympians.deities.find(d=>d.id===id)!.name[language]).join(' ↔ ')}</h4><p>{copy[pair.myth]}</p><OlympianSources ids={pair.sourceIds} copy={copy}/><h4>{c.interpretation}</h4><p>{copy[pair.life]}</p><p>{copy[pair.practice]}</p><p lang="el">{pair.word.greek}</p><p>{copy[pair.word.meaning]}</p><code>{olympianLetterEquation(pair.word.greek)}</code></article>)}
   {relation.myths.extra.map(m=><article key={m.id}><p>{g.extraMyths[m.copyIndex]}</p><a href={m.source} target="_blank" rel="noreferrer">{m.passage}</a></article>)}
   {!relation.myths.olympian.length&&!relation.myths.extra.length?<p>{c.noMyth}</p>:null}
   <p className="gno-muted">{g.modelNote}</p>
  </details>
  <details><summary>{c.numbers}</summary>{relation.numbers.map(n=><article key={`${n.left.id}:${n.right.id}`}><h4>{externalDeityName(n.left.id,language)} ↔ {externalDeityName(n.right.id,language)}</h4>{[n.left,n.right].map((item,i)=><div key={i}><code lang="el">{olympianLetterEquation(item.greek)}</code>{copy?<p>{copy.root}: {item.root} · {copy[`rootName.${item.root}`]}<br/>{copy[`rootMeaning.${item.root}`]}</p>:null}</div>)}<code>E = {n.exact}; R = {n.sameRoot}; gcd = {n.divisor}<br/>D = 2 gcd / (S₁ + S₂) = {n.ratio.toFixed(4)}<br/>N = {n.identity?'0':'.55 E + .25 R + .20 D'} = {n.index.toFixed(4)}<br/>{n.x} + {n.y} + {n.balance.letter}({n.balance.value}) = {n.balance.total} → {n.balance.trace.slice(1).join(' → ')}</code><p>{n.identity?c.identityNote:c.symbolicNote}</p></article>)}</details>
  {copy?<details className="gno-olympian-library"><summary>{copy.thirteen}</summary><p>{copy.thirteenText}</p>{olympianContext(draft).map(context=><details key={context.deity}><summary>{externalDeityName(context.deity,language)} · {context.number.right.sum}</summary><p>{olympians.deities.find(row=>row.id===context.deity)!.summary[language]}</p><code>{olympianLetterEquation(context.number.right.greek)}<br/>ρ({context.number.x} + {context.number.y}) = {context.number.balance.root}</code>{context.pair?<><p>{copy[context.pair.myth]}</p><p>{copy[context.pair.life]}</p><OlympianSources ids={context.pair.sourceIds} copy={copy}/></>:null}</details>)}<label className="gno-field"><span>{copy.compare}</span><select aria-label={copy.compare} value={deity.id} onChange={e=>setSelected(e.target.value)}>{olympians.deities.map(row=><option key={row.id} value={row.id}>{row.name[language]} · {row.number}</option>)}</select></label><div className="gno-projection-line"><img src={`/theokyklos-symbols/olympian-${deity.id}-v313.png`} alt="" width="48" height="48"/><h4>{deity.name[language]}</h4></div><OlympianKnowledge key={deity.id} deity={deity} deities={olympians.deities} language={language} copy={copy} onSelect={row=>setSelected(row.id)}/><OlympianGuide copy={copy}/></details>:null}
 </section>;
}
