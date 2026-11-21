import {encodeE2eeBytes} from './envelope.ts';
type Row=Record<string,unknown>;
/** Complete bounded local query. No title, filter, custom value or sorting key
 * is sent to a plaintext server index. A cursor from the old query is rejected. */
export async function privateSharedTaskPage(input:Row[],sort='position',sourceVersions:unknown=[]){
 if(input.length>10000||new Set(input.map(row=>row.id)).size!==input.length)throw new Error('E2EE_SHARED_QUERY_TOO_LARGE');const tasks=structuredClone(input),custom=/^custom:([A-Za-z0-9_-]{1,100}):(asc|desc)$/.exec(sort);
 const sorts:Record<string,{field:string;direction:number}>={position:{field:'position',direction:1},dueDate:{field:'dueDate',direction:1},priority:{field:'priority',direction:-1},updatedAt:{field:'updatedAt',direction:-1},title:{field:'title',direction:1},createdAt:{field:'createdAt',direction:-1},createdAtAsc:{field:'createdAt',direction:1}};
 if(!custom&&!Object.hasOwn(sorts,sort))throw new Error('E2EE_SHARED_FILTER_INVALID');
 const {field,direction}=custom?{field:custom[1],direction:custom[2]==='asc'?1:-1}:sorts[sort],value=(row:Row)=>custom?(row.customFields as Row|undefined)?.[field]:row[field];
 tasks.sort((a,b)=>{const left=value(a),right=value(b),empty=(value:unknown)=>value===undefined||value===null||value==='';if(empty(left))return empty(right)?String(a.id).localeCompare(String(b.id)):1;if(empty(right))return -1;
  const compared=typeof left==='number'&&typeof right==='number'?left-right:typeof left==='boolean'&&typeof right==='boolean'?Number(left)-Number(right):String(left).localeCompare(String(right));return direction*compared||String(a.id).localeCompare(String(b.id));});
 const statusCounts:Record<string,number>={},dateCounts:Record<string,number>={};const dates:string[]=[];for(const row of tasks){const status=String(row.statusId);statusCounts[status]=(statusCounts[status]??0)+1;if(typeof row.dueDate==='string'){dateCounts[row.dueDate]=(dateCounts[row.dueDate]??0)+1;dates.push(row.dueDate);}}
 dates.sort();const bytes=new TextEncoder().encode(JSON.stringify({sort,sourceVersions,tasks}));if(bytes.length>128*1024*1024)throw new Error('E2EE_SHARED_QUERY_TOO_LARGE');
 try{return{tasks,total:tasks.length,hasMore:false,nextCursor:null,statusCounts,dateCounts,consistency:'restart-on-change',queryVersion:encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))),bounds:{first:dates[0]??null,last:dates.at(-1)??null}};}finally{bytes.fill(0);}
}
export function privateSharedCustomFieldMatch(values:unknown,criteria:unknown){
 if(!Array.isArray(criteria)||criteria.length>100)throw new Error('CUSTOM_FIELD_FILTER_INVALID');const fields=values&&typeof values==='object'&&!Array.isArray(values)?values as Row:{};
 return criteria.every(row=>{if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.fieldId!=='string'||!['exists','missing','eq','ne','contains','gt','gte','lt','lte'].includes(row.op))throw new Error('CUSTOM_FIELD_FILTER_INVALID');
  const value=fields[row.fieldId],missing=value===null||value===undefined||value==='';if(row.op==='exists')return !missing;if(row.op==='missing')return missing;
  if(!Object.hasOwn(row,'value'))throw new Error('CUSTOM_FIELD_FILTER_INVALID');const right=row.value;
  if(row.op==='eq'||row.op==='ne'){const equal=JSON.stringify(value??null)===JSON.stringify(right);return row.op==='eq'?equal:!equal;}
  if(row.op==='contains')return Array.isArray(value)?value.includes(right):typeof value==='string'&&typeof right==='string'&&value.toLocaleLowerCase().includes(right.toLocaleLowerCase());
  if(missing||typeof value!==typeof right||typeof value!=='string'&&typeof value!=='number')return false;
  if(row.op==='gt')return value>right;if(row.op==='gte')return value>=right;if(row.op==='lt')return value<right;return value<=right;
 });
}
