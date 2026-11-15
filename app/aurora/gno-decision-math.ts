/** Versioned design parameters, not a claim of universal optimality. */
export const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLDEN_PRIMARY = 1 / PHI;
export const GOLDEN_SECONDARY = 1 / (PHI * PHI);
export const LEARNED_LIMIT = 1 / PHI ** 5;
const clamp=(n:number)=>Math.max(0,Math.min(1,Number.isFinite(n)?n:0));
/** The tetractys 1+2+3+4=10. Feasibility must ALSO pass a hard gate outside
 * this score; no amount of symbolism can compensate for a forbidden action. */
export function tetractys(parts:{symbol:number;resources:number;context:number;robustness:number}){
 return (clamp(parts.symbol)+2*clamp(parts.resources)+3*clamp(parts.context)+4*clamp(parts.robustness))/10;
}
export type RouteStep='observe'|'prepare'|'compare'|'contact'|'agree'|'act'|'review'|'rest'|'boundary';
export const ROUTE_ORDER:readonly RouteStep[]=['observe','prepare','compare','contact','agree','rest','boundary','act','review'];
/** A directed cubical path model (trace monoid): a filled square permits
 * swapping two independent operations. This is an elementary path homotopy,
 * not permission to delete a required operation or reverse a dependency.
 * Observation and preparation commute only when preparation is reversible
 * and already accessible; checking the result never commutes with acting. */
export function independentSteps(a:RouteStep,b:RouteStep,canPrepareIndependently:boolean){
 return canPrepareIndependently&&((a==='observe'&&b==='prepare')||(a==='prepare'&&b==='observe'));
}
export function homotopyClass(path:readonly RouteStep[],canPrepareIndependently:boolean):string{
 const result=[...path];
 for(let pass=0;pass<result.length;pass++)for(let i=1;i<result.length;i++){
  if(independentSteps(result[i-1],result[i],canPrepareIndependently)&&ROUTE_ORDER.indexOf(result[i-1])>ROUTE_ORDER.indexOf(result[i])){
   [result[i-1],result[i]]=[result[i],result[i-1]];
  }
 }
 return result.join('>');
}
/** Audit witness: each rewrite uses a filled square and keeps both operations. */
export function routeVariants(path:readonly RouteStep[],canPrepareIndependently:boolean){
 const variants=[...path].reduce<RouteStep[][]>((all,_,index)=>{
  if(index+1<path.length&&independentSteps(path[index],path[index+1],canPrepareIndependently)){
   const swapped=[...path];[swapped[index],swapped[index+1]]=[swapped[index+1],swapped[index]];all.push(swapped);
  }return all;
 },[[...path]]);
 return variants.map(steps=>({steps,classId:homotopyClass(steps,canPrepareIndependently)}));
}
