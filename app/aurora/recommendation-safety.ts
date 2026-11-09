import type {SituationProfile} from './types';

const fact=(profile:SituationProfile,field:string)=>profile.fields[field]?.status==='known'?profile.fields[field].value:null;
export const hasActionSafetyStop=(profile:SituationProfile)=>['immediate_danger','ongoing_harm','revision_causes_irreversible_harm'].some(field=>fact(profile,field)===true)
 ||fact(profile,'small_step_possible')===false;
export const canRecommendContact=(profile:SituationProfile)=>!hasActionSafetyStop(profile)
 &&fact(profile,'contact_safe')===true&&fact(profile,'other_agreement')===true
 &&!['contact_is_unsafe','boundary_contact_is_unsafe','contact_is_overwhelming','mediator_not_trusted'].some(field=>fact(profile,field)===true);
