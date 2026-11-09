import {CURATOR_IDS, SECTOR_IDS, type SectorId} from './registry';
import {SECONDARY_MODEL_ID,SOURCE_MODEL_ID,SOURCE_PROJECTION_VERSION,sourceSectorFunctions} from './source-model';
import type {DrawnCard, Orientation, PrimaryDrawSnapshot} from './types';

export const PRIMARY_LAYOUT_VERSION='stoicheion-nine-row-major-v1';
export const ANCHOR_MAP_VERSION='stoicheion-directions-identity-v1';
export const PROJECTION_VERSION=SOURCE_PROJECTION_VERSION;
export const ANCHOR_MAP=Object.freeze(SECTOR_IDS.map(id=>Object.freeze({sourcePositionId:id,secondarySectorId:id})));
export const SOURCE_CARD_IDS=['alpha','beta','gamma','delta','epsilon','zeta','eta','theta','iota','kappa','lambda','mu','nu','xi','omicron','pi','rho','sigma','tau','upsilon','phi','chi','psi','omega'] as const;

export function makePrimarySnapshot(input:{id:string;sourceDay:string;sourceSeed:number;createdAt:string;
  cards:readonly {cardId:string;reversed:boolean|null;positionId:SectorId}[]}):PrimaryDrawSnapshot {
  const cards:DrawnCard[]=input.cards.map((card,index)=>({
    cardId:card.cardId,cardInstanceId:`${input.id}:${index}:${card.cardId}`,sourcePositionId:card.positionId,
    orientation:card.reversed===null?'unknown':card.reversed?'reversed':'upright',weight:card.cardId==='kappa'?0:1,
    temporalRole:card.cardId==='kappa'?'kronos':card.cardId==='chi'?'chronos':null,
    functions:card.cardId==='kappa'?[]:sourceSectorFunctions(card.positionId),
  }));
  return validatePrimarySnapshot({id:input.id,source:'stoicheion-spread',sourceModelId:SOURCE_MODEL_ID,secondaryModelId:SECONDARY_MODEL_ID,
    anchorMapVersion:ANCHOR_MAP_VERSION,layoutId:PRIMARY_LAYOUT_VERSION,projectionVersion:PROJECTION_VERSION,
    sourceDay:input.sourceDay,sourceSeed:input.sourceSeed,createdAt:input.createdAt,cards});
}

/** Validate at every load/save boundary, including state sent by a modified UI. */
export function validatePrimarySnapshot(value:PrimaryDrawSnapshot):PrimaryDrawSnapshot {
  if(!value || typeof value.id!=='string' || !value.id || value.id.length>150 || value.source!=='stoicheion-spread'
    || value.layoutId!==PRIMARY_LAYOUT_VERSION || value.projectionVersion!==PROJECTION_VERSION
    || value.sourceModelId!==SOURCE_MODEL_ID || value.secondaryModelId!==SECONDARY_MODEL_ID || value.anchorMapVersion!==ANCHOR_MAP_VERSION
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.sourceDay) || !Number.isFinite(Date.parse(value.sourceDay+'T12:00:00Z')) || !Number.isFinite(Date.parse(value.createdAt))
    || !Number.isInteger(value.sourceSeed) || value.sourceSeed<0 || value.sourceSeed>0xffffffff
    || !Array.isArray(value.cards) || value.cards.length!==9) throw new Error('AURORA_INVALID_PRIMARY_SNAPSHOT');
  const instances=new Set<string>(),positions=new Set<string>(),catalogIds=new Set<string>();let trumps=0;
  for(const [index,card] of value.cards.entries()) {
    if(!card || !SOURCE_CARD_IDS.includes(card.cardId as typeof SOURCE_CARD_IDS[number])
      || typeof card.cardInstanceId!=='string' || !card.cardInstanceId || card.cardInstanceId.length>220 || instances.has(card.cardInstanceId)
      || positions.has(card.sourcePositionId) || card.sourcePositionId!==SECTOR_IDS[index] || catalogIds.has(card.cardId)
      || !(['upright','reversed','unknown'] as string[]).includes(card.orientation)) throw new Error('AURORA_INVALID_CARD_INSTANCE');
    instances.add(card.cardInstanceId);positions.add(card.sourcePositionId);catalogIds.add(card.cardId);
    if(card.temporalRole==='kronos') {
      trumps++;if(card.cardId!=='kappa' || card.weight!==0 || !Array.isArray(card.functions) || card.functions.length) throw new Error('AURORA_INVALID_TRUMP');
    }else {
      if(card.cardId==='kappa' || card.weight!==1 || card.temporalRole!==(card.cardId==='chi'?'chronos':null)) throw new Error('AURORA_INVALID_WEIGHT_OR_TIME_ROLE');
      if(card.functions!==null) {
        if(!Array.isArray(card.functions)||!card.functions.length) throw new Error('AURORA_INVALID_PROJECTION');
        let sum=0;const functions=new Set<string>();
        for(const share of card.functions){if(!CURATOR_IDS.includes(share.deityId)||functions.has(share.deityId)||!Number.isFinite(share.share)||share.share<=0)throw new Error('AURORA_INVALID_PROJECTION');sum+=share.share;functions.add(share.deityId);}
        if(Math.abs(sum-1)>1e-12)throw new Error('AURORA_PROJECTION_MASS_MISMATCH');
      }
      // Projection belongs to this adapter and cannot be supplied by prose or a modified UI.
      const expected=sourceSectorFunctions(card.sourcePositionId);
      if(card.functions?.length!==expected.length||expected.some((share,i)=>share.deityId!==card.functions?.[i].deityId||share.share!==card.functions?.[i].share))
        throw new Error('AURORA_UNAPPROVED_PROJECTION');
    }
  }
  if(trumps>1)throw new Error('AURORA_DUPLICATE_TRUMP');
  return value;
}

export function eligibleSectors(snapshot:PrimaryDrawSnapshot):SectorId[] {
  validatePrimarySnapshot(snapshot);
  return SECTOR_IDS.filter(id=>snapshot.cards.some(card=>card.sourcePositionId===id && card.orientation==='reversed'));
}
export function assertEligibleSector(snapshot:PrimaryDrawSnapshot,sectorId:SectorId|null):void {
  if(sectorId!==null&&!eligibleSectors(snapshot).includes(sectorId))throw new Error('AURORA_SECTOR_NOT_ELIGIBLE');
}
export function kronosOrientation(snapshot:PrimaryDrawSnapshot):Orientation|'absent' {
  validatePrimarySnapshot(snapshot);
  return snapshot.cards.find(c=>c.temporalRole==='kronos')?.orientation??'absent';
}
