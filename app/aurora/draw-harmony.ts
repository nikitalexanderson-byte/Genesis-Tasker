import {STOICHEION_NUMERALS} from '../stoicheion-numerals';
import {validatePrimarySnapshot} from './spread';
import type {PrimaryDrawSnapshot,OptionalTemporalTriadSnapshot} from './types';

export const DRAW_HARMONY_VERSION='aurora-nine-pythmen-v1';
const PHI=(1+Math.sqrt(5))/2;
export const HARMONY_WEIGHT=PHI**-4;
export type DrawHarmony={version:typeof DRAW_HARMONY_VERSION;sourceSnapshotId:string;total:number;pythmen:number;temporalTotal:number|null;temporalPythmen:number|null};
export function numberRoot(value:number):number {
 if(!Number.isSafeInteger(value)||value<1)throw Error('AURORA_HARMONY_INVALID');
 return 1+(value-1)%9;
}
function cardTotal(cards:readonly {cardId:string}[]):number {
 return cards.reduce((sum,card)=>{const numeral=STOICHEION_NUMERALS.find(row=>row.id===card.cardId);if(!numeral)throw Error('AURORA_HARMONY_CARD');return sum+numeral.value;},0);
}
/** The primary sum is exactly the sum printed beside the nine-card spread,
 * including Kronos. Reversal changes semantic channels, never a letter's value. */
export function drawHarmony(primary:PrimaryDrawSnapshot,temporal:OptionalTemporalTriadSnapshot|null=null):DrawHarmony {
 validatePrimarySnapshot(primary);
 const total=cardTotal(primary.cards),temporalTotal=temporal?cardTotal(temporal.cards):null;
 return {version:DRAW_HARMONY_VERSION,sourceSnapshotId:primary.id,total,pythmen:numberRoot(total),
  temporalTotal,temporalPythmen:temporalTotal===null?null:numberRoot(temporalTotal)};
}
function alignment(root:number,target:number):number {return (1+Math.cos(2*Math.PI*(numberRoot(target)-root)/9))/2;}
/** One bounded author-defined numerical term for every suitability rank. It is
 * not empirical evidence, an event probability, or an ancient attested law. */
export function unifiedSuitability(core:number,harmony:DrawHarmony|undefined,target:number):number {
 if(!Number.isFinite(core)||core<0||core>1)throw Error('AURORA_HARMONY_SCORE');
 if(!harmony)return core; // Historical saved preferences remain compatible.
 if(harmony.version!==DRAW_HARMONY_VERSION||numberRoot(harmony.total)!==harmony.pythmen
  ||(harmony.temporalTotal===null)!==(harmony.temporalPythmen===null)
  ||harmony.temporalTotal!==null&&numberRoot(harmony.temporalTotal)!==harmony.temporalPythmen)throw Error('AURORA_HARMONY_INVALID');
 const primary=alignment(harmony.pythmen,target);
 const numerical=harmony.temporalPythmen===null?primary:primary/PHI+alignment(harmony.temporalPythmen,target)/(PHI*PHI);
 return (1-HARMONY_WEIGHT)*core+HARMONY_WEIGHT*numerical;
}
