/* eslint-disable @next/next/no-img-element -- Preserve the original local cards and patron artwork. */
import {useEffect,useId,useRef,useState} from 'react';
import {useDialogAccessibility} from '../use-dialog-accessibility';
import {DialogCloseButton} from '../DialogCloseButton';
import {getStoicheionLetters} from '../stoicheion-data';
import {StoicheionCardFace} from '../StoicheionCardFace';
import {ExperimentalIcon} from '../ExperimentalIcon';
import type {Language} from '../i18n';
import {SECTORS,DEITIES,type SectorId} from './registry';
import {SOURCE_CIRCLE_REFERENCE} from './source-model';
import {eligibleSectors} from './spread';
import {cardInsight} from './card-insights';
import type {PrimaryDrawSnapshot} from './types';
import RU from './texts.ru.json';

export function AuroraCards({snapshot,secondary,selected,selectedSectors,onChoose,language}:{
 snapshot:PrimaryDrawSnapshot;secondary:boolean;selected:SectorId|null;selectedSectors?:readonly SectorId[];onChoose?:(id:SectorId)=>void;language:Language;
}) {
 const [all,setAll]=useState(false),[page,setPage]=useState(0),[inspected,setInspected]=useState<string|null>(null);
 const deckId=useId(),detailsId=useId(),tiles=useRef(new Map<string,HTMLButtonElement>()),modal=useRef<HTMLDialogElement>(null);
 const focus=useDialogAccessibility<HTMLDialogElement>(()=>setInspected(null),Boolean(inspected));
 useEffect(()=>{if(inspected&&!modal.current?.open)modal.current?.showModal();else if(!inspected)modal.current?.close();},[inspected]);
 const letters=getStoicheionLetters(language),eligible=eligibleSectors(snapshot);
 const reversed=snapshot.cards.filter(card=>card.orientation==='reversed');
 const cards=all||!reversed.length?snapshot.cards:reversed;
 const current=Math.min(page,Math.max(0,Math.ceil(cards.length/3)-1)),visible=cards.slice(current*3,current*3+3);
 const detail=visible.find(card=>card.cardInstanceId===inspected),insight=detail?cardInsight(detail,language,secondary?'desired':'source'):null;
 const detailLetter=detail?letters.find(letter=>letter.id===detail.cardId):null;
 function move(next:number){setPage(next);setInspected(null);}
 return <section className="aurora-card-browser" aria-label={secondary?RU.text0054:RU.text0055}>
  <div id={deckId} className={`aurora-circle${secondary?' is-secondary':''}`}>
   {visible.map(card=>{
    const sector=SECTORS.find(item=>item.id===card.sourcePositionId)!,source=SOURCE_CIRCLE_REFERENCE.find(item=>item.id===card.sourcePositionId)!;
    const letter=letters.find(item=>item.id===card.cardId)!,negative=card.orientation==='reversed',chosen=selectedSectors?selectedSectors.includes(sector.id):selected===sector.id;
    const status=chosen?RU.text0060:negative?RU.notSelectedState:RU.normalState;
    const content=<><span className="aurora-direction">{sector.title}</span>
     <span className="aurora-card-visual is-face">
      <StoicheionCardFace letter={letter} reversed={negative} variant="dialog" language={language}/>
     </span><strong>{letter.name}</strong><span className="aurora-orientation">{negative?RU.text0056:RU.text0057}</span>
     {secondary?<><span className="aurora-patron-images">{sector.deities.map(id=><img key={id} src={`/theokyklos-symbols/olympian-${id}-${id==='kronos'?'v324':'v313'}.png`} alt="" width="36" height="36"/>)}</span>
      <small>{sector.deities.map(id=>DEITIES[id].name).join(', ')}</small><span className="aurora-selection-status"><span className="aurora-selection-box" aria-hidden="true">{chosen?<ExperimentalIcon name="check"/>:null}</span>{status}</span></>
      :<small>{source.patrons.ru}</small>}
    </>;
    return <div className="aurora-sector-wrap" key={card.cardInstanceId}><button type="button" className="aurora-sector" data-state={negative?'negative':'positive'}
     ref={node=>{if(node)tiles.current.set(card.cardInstanceId,node);else tiles.current.delete(card.cardInstanceId);}}
     aria-label={`${sector.title}: ${letter.name} ${letter.symbol}, ${secondary?status:negative?RU.cardProblem:RU.cardSupport}`}
     aria-pressed={secondary?chosen:undefined} disabled={secondary&&!eligible.includes(sector.id)}
     aria-expanded={!secondary?inspected===card.cardInstanceId:undefined} aria-controls={!secondary&&inspected===card.cardInstanceId?detailsId:undefined}
     onClick={()=>secondary?onChoose?.(sector.id):setInspected(inspected===card.cardInstanceId?null:card.cardInstanceId)}>{content}</button>
     {secondary?<button type="button" className="secondary-button aurora-card-info" aria-label={`${RU.text0221}: ${letter.name}, ${sector.title}`} onClick={()=>setInspected(card.cardInstanceId)}><ExperimentalIcon name="info"/></button>:null}</div>;
   })}
  </div>
  {cards.length>3?<nav className="aurora-card-pagination" aria-label={RU.cardsPages}>
   <button type="button" className="secondary-button" aria-label={RU.cardsPrevious} disabled={current===0} onClick={()=>move(current-1)}><ExperimentalIcon name="chevron-left"/></button>
   <span role="status" aria-live="polite">{current*3+1}–{Math.min(current*3+3,cards.length)} / {cards.length}</span>
   <button type="button" className="secondary-button" aria-label={RU.cardsNext} disabled={(current+1)*3>=cards.length} onClick={()=>move(current+1)}><ExperimentalIcon name="chevron"/></button>
  </nav>:null}
  <button type="button" className="secondary-button aurora-show-cards" aria-expanded={all} aria-controls={deckId}
   onClick={()=>{setAll(!all);move(0);}}>{all?RU.showReversedCards:RU.showAllCards}</button>
  {insight&&detailLetter?<dialog ref={element=>{modal.current=element;focus(element);}} id={detailsId} className="aurora-card-insight" data-dialog-header="none" aria-labelledby={`${detailsId}-title`} onCancel={event=>{event.preventDefault();setInspected(null);}}>
   <header><h4 id={`${detailsId}-title`}>{insight.reversed?RU.cardProblem:RU.cardSupport}: {insight.name} · {insight.sector}</h4>
    <DialogCloseButton aria-label={RU.closeCard} onClick={()=>setInspected(null)}/></header>
   <div className="aurora-card-insight-body">
    <div className="aurora-card-insight-art"><StoicheionCardFace letter={detailLetter} reversed={insight.reversed} variant="dialog" language={language}/></div>
    <div className="aurora-card-insight-copy">
     <p><strong lang="el">{insight.symbol}</strong> · {insight.patrons}</p><p>{insight.sectorMeaning}</p>
     <p data-no-translate>{insight.focus}</p><p>{insight.bridge}</p><p>{insight.question}</p>
     <section className="aurora-card-insight-reading"><h5 data-no-translate>{insight.name}</h5><div data-no-translate><p>{insight.heading}</p><ul>{insight.lines.map((line,index)=><li key={index}>{line}</li>)}</ul></div></section>
    </div>
   </div>
  </dialog>:null}
 </section>;
}
