/** Structural scores are not event probabilities. The graph is a finite 1-complex. */
export const TRANSFORMATION_MATH_VERSION='fibonacci-tetractys-hodge-v1';
export const GOLDEN_RATIO=(1+Math.sqrt(5))/2;
export const FIBONACCI_WEIGHTS=[13,8,5,3,2] as const;
export const TETRACTYS_WEIGHTS=[1,2,3,4] as const;
export function harmonicScore(parts:readonly number[]):number{
 if(parts.length!==5||parts.some(value=>!Number.isFinite(value)||value<0||value>1))throw Error('AURORA_TRANSFORMATION_SCORE');
 const fibonacci=parts.reduce((sum,value,index)=>sum+value*FIBONACCI_WEIGHTS[index],0)/31;
 const tetractys=parts.slice(0,4).reduce((sum,value,index)=>sum+value*TETRACTYS_WEIGHTS[index],0)/10;
 return fibonacci/GOLDEN_RATIO+tetractys/(GOLDEN_RATIO*GOLDEN_RATIO);
}
export type TopologyEdge={from:string;to:string;weight:number};
/** Weighted Hodge 0-Laplacian. Gaussian elimination solves (I+L)x=b,
 * the unique minimizer of ||x-b||²/2 + xᵀLx/2. No convergence heuristics. */
export function transformationTopology(edges:readonly TopologyEdge[],signal:Readonly<Record<string,number>>={}){
 const vertices=[...new Set(edges.flatMap(edge=>[edge.from,edge.to]))].sort();
 if(vertices.length>32||edges.length>128||edges.some(edge=>!Number.isFinite(edge.weight)||edge.weight<=0||edge.weight>1))throw Error('AURORA_TRANSFORMATION_GRAPH');
 const index=new Map(vertices.map((vertex,i)=>[vertex,i])),parent=vertices.map((_,i)=>i),find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]));
 const laplacian=vertices.map(()=>vertices.map(()=>0));
 for(const edge of edges){const a=index.get(edge.from)!,b=index.get(edge.to)!;if(a===b)continue;parent[find(a)]=find(b);
  laplacian[a][a]+=edge.weight;laplacian[b][b]+=edge.weight;laplacian[a][b]-=edge.weight;laplacian[b][a]-=edge.weight;
 }
 const beta0=new Set(vertices.map((_,i)=>find(i))).size,beta1=edges.length-vertices.length+beta0;
 const rhs=vertices.map(vertex=>signal[vertex]??0);if(rhs.some(value=>!Number.isFinite(value)||value<0||value>1))throw Error('AURORA_TRANSFORMATION_SIGNAL');
 const augmented=laplacian.map((row,i)=>[...row.map((value,j)=>value+(i===j?1:0)),rhs[i]]);
 for(let pivot=0;pivot<vertices.length;pivot++){
  const divisor=augmented[pivot][pivot];if(divisor<=0)throw Error('AURORA_TRANSFORMATION_SINGULAR');
  for(let j=pivot;j<=vertices.length;j++)augmented[pivot][j]/=divisor;
  for(let i=0;i<vertices.length;i++)if(i!==pivot){const factor=augmented[i][pivot];for(let j=pivot;j<=vertices.length;j++)augmented[i][j]-=factor*augmented[pivot][j];}
 }
 const solution=augmented.map(row=>row.at(-1)!);
 const gradient=solution.map((value,i)=>value-rhs[i]+laplacian[i].reduce((sum,w,j)=>sum+w*solution[j],0));
 const residual=Math.max(0,...gradient.map(Math.abs));if(residual>1e-10)throw Error('AURORA_TRANSFORMATION_RESIDUAL');
 const energy=.5*solution.reduce((sum,value,i)=>sum+(value-rhs[i])**2+value*laplacian[i].reduce((total,w,j)=>total+w*solution[j],0),0);
 // Integral of squared edge gradients on this finite complex (Dirichlet energy).
 const dirichlet=edges.reduce((sum,edge)=>sum+edge.weight*(solution[index.get(edge.from)!]-solution[index.get(edge.to)!])**2,0);
 return {version:TRANSFORMATION_MATH_VERSION,vertices,beta0,beta1,boundaryRank:vertices.length-beta0,energy,dirichlet,residual,values:Object.fromEntries(vertices.map((vertex,i)=>[vertex,solution[i]]))};
}
