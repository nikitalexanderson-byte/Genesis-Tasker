import {LEARNED_LIMIT} from './gno-decision-math';

export const PERSONAL_RANKING_VERSION='gno-personal-40x4-v1';
export const FEATURE_COUNT=40;
const HIDDEN=4, EPOCHS=60, MAX_SAMPLES=200;
export type RatedDecision={planId:string;features:readonly number[];helped:boolean;at:string};
export type PersonalRanking={active:boolean;samples:number;parameters:number;validationLoss:number|null;baselineLoss:number|null;score:(features:readonly number[])=>number};
const valid=(x:readonly number[])=>x.length===FEATURE_COUNT&&x.every(n=>Number.isFinite(n)&&n>=0&&n<=1);
const sigmoid=(x:number)=>1/(1+Math.exp(-Math.max(-20,Math.min(20,x))));
/** Tiny private contextual learner: 169 parameters, reconstructed from the
 * owner's encrypted feedback, no service, network request, or global training.
 * Chronological holdout + a constant baseline prevent claiming learning from
 * a few successful examples. One latest rating per actually executed plan. */
export function personalRanking(history:readonly RatedDecision[]):PersonalRanking{
 const unique=new Map<string,RatedDecision>();
 for(const row of [...history].sort((a,b)=>a.at.localeCompare(b.at)))if(valid(row.features)&&Number.isFinite(Date.parse(row.at)))unique.set(row.planId,row);
 const rows=[...unique.values()].sort((a,b)=>a.at.localeCompare(b.at)).slice(-MAX_SAMPLES);
 const fallback:PersonalRanking={active:false,samples:rows.length,parameters:0,validationLoss:null,baselineLoss:null,score:()=>0};
 if(rows.length<12||rows.filter(r=>r.helped).length<3||rows.filter(r=>!r.helped).length<3)return fallback;
 const split=Math.floor(rows.length*.75),train=rows.slice(0,split),holdout=rows.slice(split);
 if(!train.some(r=>r.helped)||!train.some(r=>!r.helped))return fallback;
 const weights=Array.from({length:HIDDEN},(_,j)=>Array.from({length:FEATURE_COUNT},(_,i)=>Math.sin((j+1)*71+(i+1)*13)*.05));
 const bias=Array(HIDDEN).fill(0) as number[],output=Array.from({length:HIDDEN},(_,j)=>Math.cos(j*31+7)*.05);
 let intercept=Math.log((train.filter(r=>r.helped).length+1)/(train.filter(r=>!r.helped).length+1));
 const forward=(x:readonly number[])=>{const hidden=weights.map((w,j)=>Math.tanh(bias[j]+w.reduce((sum,v,i)=>sum+v*x[i],0)));return {hidden,p:sigmoid(intercept+hidden.reduce((sum,h,j)=>sum+h*output[j],0))};};
 for(let epoch=0;epoch<EPOCHS;epoch++)for(const row of train){
  const {hidden,p}=forward(row.features),error=p-Number(row.helped),rate=.04/Math.sqrt(1+epoch/10),oldOutput=[...output];
  intercept-=rate*error;
  for(let j=0;j<HIDDEN;j++){
   output[j]-=rate*(error*hidden[j]+.01*output[j]);
   const grad=Math.max(-.5,Math.min(.5,error*oldOutput[j]*(1-hidden[j]**2)));
   bias[j]-=rate*grad;
   for(let i=0;i<FEATURE_COUNT;i++)weights[j][i]-=rate*(grad*row.features[i]+.01*weights[j][i]);
  }
 }
 const baseline=(train.filter(r=>r.helped).length+1)/(train.length+2);
 const loss=holdout.reduce((s,r)=>s+(forward(r.features).p-Number(r.helped))**2,0)/holdout.length;
 const baselineLoss=holdout.reduce((s,r)=>s+(baseline-Number(r.helped))**2,0)/holdout.length;
 if(!Number.isFinite(loss)||loss+.005>=baselineLoss)return {...fallback,validationLoss:loss,baselineLoss};
 return {active:true,samples:rows.length,parameters:HIDDEN*FEATURE_COUNT+HIDDEN+HIDDEN+1,validationLoss:loss,baselineLoss,
  score:x=>valid(x)?Math.max(-LEARNED_LIMIT,Math.min(LEARNED_LIMIT,(forward(x).p-baseline)*LEARNED_LIMIT)):0};
}
