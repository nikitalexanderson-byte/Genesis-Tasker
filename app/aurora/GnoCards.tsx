import {useId} from 'react';
import {catalogText} from '../catalog-i18n';
import {getStoicheionLetters} from '../stoicheion-data';
import {StoicheionCardFace} from '../StoicheionCardFace';
import type {Language} from '../i18n';
import type {PrimaryDrawSnapshot} from './types';
import {SECTOR_IDS,type SectorId} from './registry';
import {SOURCE_CIRCLE_REFERENCE} from './source-model';
import {gnoCopy} from './gno-copy';

export function GnoCards({primary,language,focus,support,onSelect}:{primary:PrimaryDrawSnapshot;language:Language;focus:SectorId;support:SectorId|null;onSelect:(id:SectorId)=>void}){
 const c=gnoCopy(language),letters=getStoicheionLetters(language),arrow=useId().replace(/:/g,''),point=(id:SectorId)=>{const i=SECTOR_IDS.indexOf(id);return {x:(i%3)*100+50,y:Math.floor(i/3)*100+50};};
 const from=support?point(support):null,to=point(focus);
 return <div className="gno-board" aria-label={c.spread}>
  <div className="gno-grid">{SECTOR_IDS.map((id,index)=>{
   const card=primary.cards.find(row=>row.sourcePositionId===id)!,letter=letters.find(row=>row.id===card.cardId)!,source=SOURCE_CIRCLE_REFERENCE.find(row=>row.id===id)!;
   const orientation=card.orientation==='reversed'?c.reversed:card.orientation==='upright'?c.upright:c.unknownOrientation;
   return <button type="button" key={id} data-testid={`gno-card-${id}`} className="gno-tile" data-focus={focus===id} data-support={support===id} aria-pressed={focus===id} aria-label={`${catalogText(source.title,language)}: ${letter.name}, ${orientation}${support===id?`, ${c.support}`:''}`} onClick={()=>onSelect(id)}>
    <span className="gno-tile-position">{index+1}<span>{focus===id?c.focus:support===id?c.support:letter.symbol}</span></span>
    <span className="gno-art"><StoicheionCardFace letter={letter} reversed={card.orientation==='reversed'} variant="dialog" language={language}/></span>
    <span className="gno-tile-name">{letter.name} <span aria-hidden="true">{card.orientation==='reversed'?'↓':'↑'}</span></span>
   </button>;
  })}</div>
  {from&&support!==focus?<svg className="gno-connection" viewBox="0 0 300 300" preserveAspectRatio="none" aria-hidden="true"><defs><marker id={arrow} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z"/></marker></defs><path d={`M ${from.x} ${from.y} Q ${(from.x+to.x)/2+20} ${(from.y+to.y)/2-20} ${to.x} ${to.y}`} markerEnd={`url(#${arrow})`}/></svg>:null}
 </div>;
}
