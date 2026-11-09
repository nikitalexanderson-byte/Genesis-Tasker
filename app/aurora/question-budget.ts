/** Stage indexes are zero-based; the fourth screen has a larger interview. */
export function questionLimitForStage(stage:number):number {
 return stage===3?20:10;
}

/** An explicit correction preserves history but does not ask a new question. */
export function answeredQuestionCount(answers:readonly {id:string;questionId:string;field:string;revisesAnswerId?:string;invalidatedByAnswerId?:string}[]):number {
 const previous=new Map<string,{questionId:string;field:string}>();let count=0;
 for(const answer of answers){
  if(answer.invalidatedByAnswerId)continue;
  const revised=answer.revisesAnswerId?previous.get(answer.revisesAnswerId):undefined;
  if(!revised||revised.questionId!==answer.questionId||revised.field!==answer.field)count++;
  previous.set(answer.id,answer);
 }
 return count;
}
