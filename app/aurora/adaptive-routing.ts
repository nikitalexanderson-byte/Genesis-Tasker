import type {AnswerRecord} from './context';
import type {QuestionRecord} from './catalog/questions';

const branches:Record<string,[string[],string[]]>={
 event_observed:[['direct_evidence','event_order_known'],['source_known','info_access']],
 direct_evidence:[['inference_distinguished','contrary_evidence'],['source_known','info_access']],
 source_known:[['info_access','contact_safe'],['independent_alternative','inference_distinguished']],
 explicit_agreement:[['deadline_defined','decision_owner_known'],['contact_safe','clear_scope']],
 external_dependency:[['decision_owner_known','other_agreement'],['small_step_possible','reversible_step']],
 decision_owner_known:[['other_agreement','contact_safe'],['source_known','independent_alternative']],
 contact_safe:[['other_agreement','explicit_agreement'],['independent_alternative','stop_condition_known']],
 other_agreement:[['explicit_agreement','deadline_defined'],['independent_alternative','voluntary_commitment']],
 resource_available:[['small_step_possible','skill_available'],['scale_limit_known','independent_alternative']],
 small_step_possible:[['reversible_step','stop_condition_known'],['available_time_known','nonnegotiable_constraint']],
 repetition_known:[['pattern_same_context','prior_exception'],['event_order_known','baseline_defined']],
 pattern_same_context:[['prior_exception','attempted_again'],['earliest_difference','event_order_known']],
 prior_exception:[['earliest_difference','previous_attempt_effect'],['attempted_again','scale_limit_known']],
 goal_is_own:[['value_named','cost_acceptable'],['voluntary_commitment','undesired_outcome_known']],
 values_share_constraint:[['cost_acceptable','scale_limit_known'],['small_step_possible','goal_wanted_with_resources']],
 deadline_defined:[['lead_time_known','condition_before_outcome'],['waiting_deadline_known','horizon_defined']],
 reversible_step:[['small_step_possible','clear_scope'],['scale_limit_known','stop_condition_known']],
 clear_scope:[['small_step_possible','target_observable'],['baseline_defined','target_observable']],
};
const fallback:Record<AnswerRecord['choiceId'],string[]>={
 yes:['small_step_possible','target_observable','reversible_step','deadline_defined','stop_condition_known'],
 no:['independent_alternative','scale_limit_known','nonnegotiable_constraint','source_known','cost_acceptable'],
 unknown:['source_known','direct_evidence','info_access','inference_distinguished','baseline_defined'],
 skipped:['goal_is_own','value_named','available_time_known','resource_available','prior_exception'],
 not_applicable:['external_dependency','goal_wanted_with_resources','change_desired','values_share_constraint','clear_scope'],
};
/** Each answer chooses a different available field, with semantic follow-ups taking precedence.
 * Earlier answers already determine the eligible set; no random wording or inferred user facts. */
export function routeQuestion(ranked:readonly QuestionRecord[],answers:readonly AnswerRecord[]):QuestionRecord|null {
 const active=answers.filter(answer=>!answer.invalidatedByAnswerId),previous=active.at(-1);
 const unique=ranked.filter((q,index)=>ranked.findIndex(row=>row.resolvesFields[0]===q.resolvesFields[0])===index);
 if(!previous)return unique[0]??null;
 const selected=new Map<string,QuestionRecord>(),used=new Set<string>();
 for(const choice of ['yes','no','unknown','skipped','not_applicable'] as const){
  const specific=branches[previous.field]?.[choice==='yes'?0:1]??[];
  const order=[...(choice==='yes'||choice==='no'?specific:[]),...fallback[choice]];
  const candidates=unique.filter(q=>!used.has(q.resolvesFields[0]));
  // Preserve the information-gain ranking within the semantically relevant follow-ups.
  const chosen=candidates.find(q=>order.includes(q.resolvesFields[0]))??candidates[0];
  if(chosen){selected.set(choice,chosen);used.add(chosen.resolvesFields[0]);}
 }
 return selected.get(previous.choiceId)??unique[0]??null;
}
