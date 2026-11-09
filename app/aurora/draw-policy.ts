import {SOURCE_CARD_IDS,makePrimarySnapshot,validatePrimarySnapshot} from './spread';
import {SECTOR_IDS} from './registry';
import type {OptionalTemporalTriadSnapshot,PrimaryDrawSnapshot} from './types';

/** Read-only verifier of the current Stoicheion algorithm. It does NOT draw or
 * write Stoicheion state. Parity tests compare it with the existing functions.
 */
function seededRandom(seed:number){let value=seed>>>0;return()=>{value=(value+0x6d2b79f5)>>>0;let mixed=value;
 mixed=Math.imul(mixed^(mixed>>>15),mixed|1);mixed^=mixed+Math.imul(mixed^(mixed>>>7),mixed|61);return ((mixed^(mixed>>>14))>>>0)/4294967296;};}
export function expectedSourceDraw(seed:number,size=9):{cardId:string;reversed:boolean}[]{
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||!Number.isInteger(size)||size<1||size>24)throw new Error('AURORA_INVALID_SEED');
 const pool=[...SOURCE_CARD_IDS],random=seededRandom(seed^0xa511e9b3);
 for(let index=pool.length-1;index>0;index--){const swap=Math.floor(random()*(index+1));[pool[index],pool[swap]]=[pool[swap],pool[index]];}
 return pool.slice(0,size).map((cardId,index)=>({cardId,reversed:seededRandom((seed^Math.imul(index+2,0x27d4eb2d))>>>0)()<0.5}));
}
export function snapshotFromSavedDraw(draw:{id:string;seed:number;day:string;createdAt:string;cards:readonly {cardId:string;reversed:boolean}[]}):PrimaryDrawSnapshot{
 const expected=expectedSourceDraw(draw.seed);
 if(draw.cards.length!==9||expected.some((c,i)=>c.cardId!==draw.cards[i].cardId||c.reversed!==draw.cards[i].reversed))throw new Error('AURORA_SOURCE_DRAW_MISMATCH');
 return makePrimarySnapshot({id:draw.id,sourceDay:draw.day,sourceSeed:draw.seed,createdAt:draw.createdAt,cards:draw.cards.map((card,i)=>({...card,positionId:SECTOR_IDS[i]}))});
}
export function verifySourceDraw(snapshot:PrimaryDrawSnapshot):void{
 validatePrimarySnapshot(snapshot);const expected=expectedSourceDraw(snapshot.sourceSeed);
 if(expected.some((c,i)=>c.cardId!==snapshot.cards[i].cardId||(c.reversed?'reversed':'upright')!==snapshot.cards[i].orientation))throw new Error('AURORA_SOURCE_DRAW_MISMATCH');
}
// Authored symbolic themes read from the existing letter catalog. They only
// select already confirmed myth conditions, never facts or a new deity canon.
const temporalTags:Readonly<Record<string,readonly string[]>>={
 alpha:['apollo','clarity','beginning'],beta:['artemis','boundary'],gamma:['earth','growth'],delta:['hermes','exchange'],epsilon:['apollo','clarity'],zeta:['athena','initiative'],eta:['hera','belonging'],theta:['zeus','measure'],iota:['anthropos','agency'],kappa:['kronos','boundary'],lambda:['leto','care'],mu:['thetis','feeling'],nu:['night','unknown'],xi:['zeus','measure'],omicron:['ares','action'],pi:['ares','boundary'],rho:['dionysus','creativity'],sigma:['preservation','rhythm'],tau:['artemis','protection'],upsilon:['zeus','choice'],phi:['light','clarity'],chi:['chronos','sequence'],psi:['psyche','feeling'],omega:['completion','limit'],
};
export function createTemporalTriad(input:{id:string;seed:number;createdAt:string}):OptionalTemporalTriadSnapshot{
 return {id:input.id,source:'aurora-explicit-add-button',sourceSeed:input.seed,policyVersion:'stoicheion-shuffle-three-roles-v1',createdAt:input.createdAt,
  cards:expectedSourceDraw(input.seed,3).map((card,index)=>({instanceId:`${input.id}:${index}:${card.cardId}`,cardId:card.cardId,role:(['past','present','future'] as const)[index],orientation:card.reversed?'reversed':'upright',tags:[...temporalTags[card.cardId]],temporalAspect:card.cardId==='kappa'?'kronos':card.cardId==='chi'?'chronos':null}))};
}
export function validateTemporalTriad(value:OptionalTemporalTriadSnapshot):void{
 if(!value||value.source!=='aurora-explicit-add-button'||value.policyVersion!=='stoicheion-shuffle-three-roles-v1'||value.sourceSeed===undefined||!Number.isFinite(Date.parse(value.createdAt)))throw new Error('AURORA_INVALID_TEMPORAL_SNAPSHOT');
 const expected=createTemporalTriad({id:value.id,seed:value.sourceSeed,createdAt:value.createdAt});
 if(JSON.stringify(value.cards)!==JSON.stringify(expected.cards))throw new Error('AURORA_TEMPORAL_DRAW_MISMATCH');
}
