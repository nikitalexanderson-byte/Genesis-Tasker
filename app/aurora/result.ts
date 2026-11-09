import {payloadHash,verifyForecast,type ForecastRecord} from './forecast';
import type {PreparedAuroraResult} from './session';
import {isopsephy} from './greek';
import {DEITIES,SECTOR_IDS,type CuratorId,type SectorId,type DeityId} from './registry';
import type {OrganonSelection} from './organon';
import {validateDecisionPlan,type DecisionPlan} from './decision-plans';
import {TRANSFORMATION_BRIDGES,PSYCHOLOGICAL_LENSES} from './transformation';
import {SOURCE_CARD_IDS} from './spread';
export type FrozenTransformation={version:1;key:string;sectors:SectorId[];spheres:string[];meaning:string;routes:{sector:SectorId;cardId:string;summary:string;route:DeityId[];sources:{url:string;passage:string}[]}[]};
export type VerifiedAuroraSolution={version:1;modelVersion:string;contextHash:string;forecastHashes:string[];forecasts:ForecastRecord[];organon:OrganonSelection|null;actionIds:string[];plans?:DecisionPlan[];transformation?:FrozenTransformation|null};
export function validateFrozenTransformation(value:FrozenTransformation):void{
 const fail=()=>{throw Error('AURORA_TRANSFORMATION_RESULT');};
 if(!value||value.version!==1||typeof value.key!=='string'||value.key.length>1000||typeof value.meaning!=='string'||value.meaning.length>12000
  ||!Array.isArray(value.sectors)||!value.sectors.length||value.sectors.length>9||new Set(value.sectors).size!==value.sectors.length||value.sectors.some(id=>!SECTOR_IDS.includes(id))
  ||!Array.isArray(value.spheres)||value.spheres.length>5||new Set(value.spheres).size!==value.spheres.length||value.spheres.some(id=>!PSYCHOLOGICAL_LENSES.some(lens=>lens.id===id))
  ||!Array.isArray(value.routes)||value.routes.length!==value.sectors.length||new Set(value.routes.map(row=>row?.sector)).size!==value.routes.length)fail();
 for(const row of value.routes){
  if(!row||!value.sectors.includes(row.sector)||!SOURCE_CARD_IDS.some(id=>id===row.cardId)||typeof row.summary!=='string'||row.summary.length>6000)fail();
  const bridge=TRANSFORMATION_BRIDGES[row.sector];
  if(!Array.isArray(row.route)||row.route.length!==bridge.route.length||row.route.some((id,index)=>id!==bridge.route[index])
   ||!Array.isArray(row.sources)||row.sources.length!==bridge.sources.length||row.sources.some((source,index)=>!source||source.url!==bridge.sources[index].url||source.passage!==bridge.sources[index].passage))fail();
 }
 if(value.key!==value.routes.map(row=>`${row.sector}:${row.cardId}:reversed`).sort().join('|'))fail();
}
export async function verifyPreparedSolution(solution:unknown,manifest:PreparedAuroraResult):Promise<VerifiedAuroraSolution>{
 if(!solution||typeof solution!=='object')throw new Error('AURORA_RESULT_MISMATCH');
 const row=solution as {version?:number;modelVersion?:string;contextHash?:string;forecastHashes?:string[];forecasts?:ForecastRecord[];organon?:{entry:{canonicalForm:string;isopsephy:number;curatorIds:CuratorId[]}}};
 if(row.version!==1||row.modelVersion!==manifest.methodVersion||row.contextHash!==manifest.contextHash||!Array.isArray(row.forecastHashes)||!Array.isArray(row.forecasts)
  ||row.forecasts.length!==row.forecastHashes.length||await payloadHash(row.forecastHashes)!==await payloadHash(manifest.forecastHashes))throw new Error('AURORA_RESULT_MISMATCH');
 for(const [i,forecast]of row.forecasts.entries()){await verifyForecast(forecast);if(forecast.payloadHash!==row.forecastHashes[i])throw new Error('AURORA_RESULT_MISMATCH');}
 if(row.organon){const word=row.organon.entry;if(isopsephy(word.canonicalForm)!==word.isopsephy||!Object.values(DEITIES).some(d=>d.curatorEligible&&d.sum===word.isopsephy))throw new Error('AURORA_RESULT_WORD_MISMATCH');}
 const plans=(solution as VerifiedAuroraSolution).plans;
 const transformation=(solution as VerifiedAuroraSolution).transformation;
 if(transformation)validateFrozenTransformation(transformation);
 if(plans!==undefined){if(!Array.isArray(plans)||plans.length>3)throw Error('AURORA_PLAN_INVALID');
  for(const plan of plans){validateDecisionPlan(plan);if(!(solution as VerifiedAuroraSolution).actionIds.includes(plan.actionId))throw Error('AURORA_PLAN_INVALID');}}
 return solution as VerifiedAuroraSolution;
}
