import {useMemo} from 'react';
import type {AuroraSession} from './session';
import {calculateModel} from './model';
import {rankScenarios,distinguishingFields} from './forecast';
import {selectQuestion} from './context';
import {transformationAtlas} from './transformation';

/** Draft selections and save acknowledgements keep the same immutable analysis inputs.
 * Keep pure analysis outside the wizard's editing and persistence closures. */
export function useAuroraAnalysis(session:AuroraSession|null){
 const primary=session?.primary,profile=session?.context,triad=session?.triad,sector=session?.selectedSectorId,answers=session?.answers;
 const sectors=session?.transformation?.sectors,spheres=session?.transformation?.spheres,choices=session?.transformation?.answers;
 const observing=session?.observationOnly,revising=session?.revisingQuestionId;
 const model=useMemo(()=>primary&&profile?calculateModel(primary,profile,triad??null):null,[primary,profile,triad]);
 const candidates=useMemo(()=>profile&&model?.status==='complete'?rankScenarios(profile,model,sector??null):[],[profile,model,sector]);
 const selectedSectors=useMemo(()=>sectors??(sector?[sector]:[]),[sectors,sector]);
 const question=useMemo(()=>profile&&primary&&answers?selectQuestion(profile,sector??null,primary,answers,distinguishingFields(candidates),selectedSectors,revising??null):null,
  [profile,primary,answers,sector,candidates,selectedSectors,revising]);
 const atlas=useMemo(()=>primary?transformationAtlas(primary,observing?primary.cards.map(card=>card.sourcePositionId):selectedSectors,spheres,choices):null,
  [primary,observing,selectedSectors,spheres,choices]);
 return {model,candidates,selectedSectors,question,atlas};
}
