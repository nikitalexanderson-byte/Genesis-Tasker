import {CURATOR_IDS, SECTOR_IDS, SECTORS} from './registry';
import {kronosOrientation, validatePrimarySnapshot} from './spread';
import type {BasePotentials, KronosAdjustedPotentials, Matrix, Orientation, PrimaryDrawSnapshot} from './types';

export const OPERATOR_VERSION='kronos-510-tetractys-phi-v1';
export const PHI=(1+Math.sqrt(5))/2;
export const KRONOS_FACTOR=PHI**(510/(510+100));
export const zeros=(rows:number,columns:number):Matrix=>Array.from({length:rows},()=>Array(columns).fill(0));
export const total=(matrix:Matrix):number=>matrix.reduce((sum,row)=>sum+row.reduce((a,b)=>a+b,0),0);
export function validateMatrix(matrix:Matrix,rows:number,columns:number):void {
  if(matrix.length!==rows||matrix.some(row=>row.length!==columns||row.some(v=>!Number.isFinite(v)||v<0)))throw new Error('AURORA_INVALID_MATRIX');
}
export function multiply(left:Matrix,right:Matrix):Matrix {
  if(!left.length||!right.length||left.some(r=>r.length!==right.length)||right.some(r=>r.length!==right[0].length))throw new Error('AURORA_MATRIX_DIMENSIONS');
  const result=zeros(left.length,right[0].length);
  for(let i=0;i<left.length;i++)for(let k=0;k<right.length;k++)for(let j=0;j<right[0].length;j++)result[i][j]+=left[i][k]*right[k][j];
  return result;
}
export function drawBasePotentials(snapshot:PrimaryDrawSnapshot):BasePotentials {
  validatePrimarySnapshot(snapshot);const values=zeros(18,9);
  snapshot.cards.forEach((card,i)=>{if(card.temporalRole==='kronos'||card.orientation==='unknown')return;
    const sector=SECTOR_IDS.indexOf(card.sourcePositionId),row=sector+(card.orientation==='reversed'?9:0);values[row][i]=card.weight;});
  return {kind:'base',values};
}
export function semanticProjection(snapshot:PrimaryDrawSnapshot):{status:'complete';z0:Matrix;mass:number}|{status:'incomplete';unresolvedInstanceIds:string[]} {
  validatePrimarySnapshot(snapshot);
  const unresolved=snapshot.cards.filter(c=>c.orientation==='unknown'||(c.temporalRole!=='kronos'&&!c.functions));
  if(unresolved.length)return {status:'incomplete',unresolvedInstanceIds:unresolved.map(c=>c.cardInstanceId)};
  const z0=zeros(26,9);
  snapshot.cards.forEach((card,column)=>{const weight=card.temporalRole==='kronos'?0:card.weight;
    if(card.temporalRole==='kronos')return;
    for(const share of card.functions??[]){const row=CURATOR_IDS.indexOf(share.deityId)+(card.orientation==='reversed'?13:0);z0[row][column]=weight*share.share;}});
  validateMatrix(z0,26,9);return {status:'complete',z0,mass:total(z0)};
}
export function aggregateSectors(z:Matrix):BasePotentials {
  validateMatrix(z,26,9);const values=zeros(18,9);
  for(let channel=0;channel<2;channel++)for(const [functionIndex,id] of CURATOR_IDS.entries()){
    const sector=SECTORS.findIndex(s=>s.deities.includes(id));if(sector<0)throw new Error('AURORA_MISSING_SECTOR');
    for(let card=0;card<9;card++)values[sector+9*channel][card]+=z[functionIndex+13*channel][card];
  }return {kind:'base',values};
}
/** Runtime discriminant and separate TS types both reject repeated application. */
export function applyKronos(base:BasePotentials,orientation:Orientation|'absent'):KronosAdjustedPotentials {
  if(base.kind!=='base'||orientation==='unknown')throw new Error('AURORA_KRONOS_INCOMPLETE_OR_REAPPLIED');
  validateMatrix(base.values,18,9);
  const sign=orientation==='upright'?1:orientation==='reversed'?-1:0;
  return {kind:'kronos-adjusted',orientation,operatorVersion:OPERATOR_VERSION,values:base.values.map((row,index)=>row.map(v=>v*KRONOS_FACTOR**(index<9?sign:-sign)))};
}
export function summarizeDraw(snapshot:PrimaryDrawSnapshot) {
  const base=drawBasePotentials(snapshot),orientation=kronosOrientation(snapshot);
  const complete=orientation!=='unknown'&&!snapshot.cards.some(c=>c.orientation==='unknown');
  const adjusted=complete?applyKronos(base,orientation):null;
  return {base,adjusted,positive:adjusted?total(adjusted.values.slice(0,9)):null,negative:adjusted?total(adjusted.values.slice(9)):null,
    negativeCardCount:snapshot.cards.filter(c=>c.orientation==='reversed').length,
    negativeSectorCount:SECTOR_IDS.filter(id=>snapshot.cards.some(c=>c.sourcePositionId===id&&c.orientation==='reversed')).length,orientation};
}
