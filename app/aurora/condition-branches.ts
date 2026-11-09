import { predicateState } from './graph';
import type { SituationProfile, Truth } from './types';

export type ScenarioBranch = { id: string; title: string; mode: 'all' | 'any'; conditions: { id: string; statement: string }[] };
export type FrozenScenarioBranch = ScenarioBranch & { state: Truth; conditionStates: Truth[]; evidenceIds: string[] };
export const branchField = (branchId: string, conditionId: string) => `branch:${branchId}:${conditionId}`;

export function validateScenarioBranch(branch: ScenarioBranch): void {
  if(!branch||!/^[-a-zA-Z0-9]{1,36}$/.test(branch.id)||typeof branch.title!=='string'||branch.title.length>160
    ||!['all','any'].includes(branch.mode)||!Array.isArray(branch.conditions)||branch.conditions.length<1||branch.conditions.length>8)
    throw new Error('AURORA_INVALID_CONDITION_BRANCH');
  const ids=new Set<string>();
  for(const condition of branch.conditions){
    if(!condition||!/^[-a-zA-Z0-9]{1,36}$/.test(condition.id)||ids.has(condition.id)
      ||typeof condition.statement!=='string'||condition.statement.length>1200)throw new Error('AURORA_INVALID_CONDITION_BRANCH');
    ids.add(condition.id);
  }
}

export function evaluateScenarioBranch(branch: ScenarioBranch,profile: SituationProfile): FrozenScenarioBranch {
  validateScenarioBranch(branch);
  const conditionStates=branch.conditions.map(condition=>condition.statement.trim().length<5?'unknown' as const
    :predicateState(profile,{field:branchField(branch.id,condition.id),operator:'eq',value:true}));
  const state:Truth=branch.title.trim().length<3?'unknown':branch.mode==='all'
    ?conditionStates.includes('false')?'false':conditionStates.every(value=>value==='true')?'true':'unknown'
    :conditionStates.includes('true')?'true':conditionStates.every(value=>value==='false')?'false':'unknown';
  const evidenceIds=[...new Set(branch.conditions.flatMap(condition=>profile.fields[branchField(branch.id,condition.id)]?.evidenceIds??[]))];
  return {...structuredClone(branch),state,conditionStates,evidenceIds};
}

export function sameFrozenBranch(branch: FrozenScenarioBranch,profile: SituationProfile): boolean {
  const evaluated=evaluateScenarioBranch(branch,profile);
  return evaluated.state===branch.state&&JSON.stringify(evaluated.conditionStates)===JSON.stringify(branch.conditionStates)
    &&JSON.stringify(evaluated.evidenceIds)===JSON.stringify(branch.evidenceIds);
}
